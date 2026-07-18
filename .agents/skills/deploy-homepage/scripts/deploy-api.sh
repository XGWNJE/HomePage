#!/usr/bin/env bash
set -Eeuo pipefail

mode="$1"
release_id="$2"
archive_sha="$3"
revision="$4"
previous_release="$5"

staging="/tmp/homepage-release-${release_id}"
releases_root="/opt/homepage-api/releases"
release_dir="${releases_root}/${release_id}"
backup_dir="/opt/homepage-api/backups/${release_id}"
data_dir="/opt/homepage-api/data"
data_db="${data_dir}/homepage-api.sqlite"
uploads_dir="${data_dir}/uploads"
env_file="/etc/homepage-api/homepage-api.env"
archive="homepage-api-${release_id}.tar.gz"
service="homepage-api.service"
api_host="127.0.0.1"
api_port="8787"
activation_db_snapshot="${backup_dir}/homepage-api.activation-pre.sqlite"
activation_db_owner="${backup_dir}/homepage-api.activation-pre.owner"
activation_db_group="${backup_dir}/homepage-api.activation-pre.group"
activation_db_mode="${backup_dir}/homepage-api.activation-pre.mode"
activation_upload_snapshot="${backup_dir}/uploads.activation-pre"
rollback_current_dir="${backup_dir}/rollback-current-$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [[ ! "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
	printf 'Invalid release ID.\n' >&2
	exit 64
fi
if [[ ! "$archive_sha" =~ ^[a-f0-9]{64}$ ]] || [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]]; then
	printf 'Invalid release identity.\n' >&2
	exit 64
fi
if [[ ! "$previous_release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
	printf 'Invalid previous release ID.\n' >&2
	exit 64
fi

verify_health() {
	local expected_revision="$1"
	local health
	for attempt in $(seq 1 15); do
		if health="$(curl -fsS "http://${api_host}:${api_port}/health" 2>/dev/null)"; then
			if printf '%s' "$health" | node -e '
				const fs = require("node:fs");
				const expectedRevision = process.argv[1];
				const health = JSON.parse(fs.readFileSync(0, "utf8"));
				if (!health.ok || health.revision !== expectedRevision || health.readiness?.database !== "ready") {
					throw new Error(`Unexpected API health: ${JSON.stringify(health)}`);
				}
			' "$expected_revision"; then
				return 0
			fi
		fi
		sleep 1
	done
	printf 'API health did not become ready for revision %s\n' "$expected_revision" >&2
	return 1
}

read_healthy_revision() {
	curl -fsS "http://${api_host}:${api_port}/health" | node -e '
		const fs = require("node:fs");
		const health = JSON.parse(fs.readFileSync(0, "utf8"));
		if (!health.ok || health.readiness?.database !== "ready" || typeof health.revision !== "string" || !health.revision) {
			throw new Error(`Current API is not ready: ${JSON.stringify(health)}`);
		}
		process.stdout.write(health.revision);
	'
}

verify_runtime_config() {
	local code_root="$1"
	local main_pid runtime_environment
	main_pid="$(systemctl show --property=MainPID --value "$service")"
	[[ "$main_pid" =~ ^[1-9][0-9]*$ ]]
	runtime_environment="/proc/${main_pid}/environ"
	test -r "$runtime_environment"

	(
		cd "$code_root"
		HOMEPAGE_RUNNING_ENV="$runtime_environment" node --input-type=module -e '
			import { readFileSync } from "node:fs";
			import { resolve } from "node:path";
			import { loadConfig } from "./src/config.js";
			const [expectedDataDir, expectedDatabasePath, expectedUploadDir, expectedPort] = process.argv.slice(1);
			const runtimeEnv = Object.fromEntries(readFileSync(process.env.HOMEPAGE_RUNNING_ENV)
				.toString("utf8")
				.split("\0")
				.filter((entry) => entry.includes("="))
				.map((entry) => {
					const separator = entry.indexOf("=");
					return [entry.slice(0, separator), entry.slice(separator + 1)];
				}));
			const config = loadConfig(runtimeEnv);
			const checks = [
				["HOMEPAGE_API_DATA_DIR", resolve(config.dataDir), resolve(expectedDataDir)],
				["DATABASE_PATH", resolve(config.databasePath), resolve(expectedDatabasePath)],
				["UPLOAD_DIR", resolve(config.uploadDir), resolve(expectedUploadDir)],
				["PORT", String(config.port), String(expectedPort)],
			];
			const mismatches = checks.filter(([, actual, expected]) => actual !== expected);
			if (mismatches.length > 0) {
				throw new Error("Runtime configuration does not match deployment assumptions: " + mismatches.map(([name]) => name).join(", "));
			}
		' "$data_dir" "$data_db" "$uploads_dir" "$api_port"
	)
}

backup_persistent_data() {
	test -f "$data_db"
	test -d "$uploads_dir"
	install -d -m 700 "$backup_dir"
	cp -p "$env_file" "$backup_dir/homepage-api.env.pre"
	printf '%s\n' "$previous_release" > "$backup_dir/previous-release.txt"
	read_healthy_revision > "$backup_dir/previous-revision.txt"

	node - "$data_db" "$backup_dir/homepage-api.pre.sqlite" <<'NODE'
const Database = require('/opt/homepage-api/current/node_modules/better-sqlite3');
const [source, destination] = process.argv.slice(2);
const database = new Database(source, { readonly: true, fileMustExist: true });
(async () => {
	try {
		await database.backup(destination);
	} finally {
		database.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
NODE

}

run_migration_probe() {
	cp "$backup_dir/homepage-api.pre.sqlite" "$backup_dir/migration-probe.sqlite"
	(
		cd "$release_dir"
		DATABASE_PATH="$backup_dir/migration-probe.sqlite" \
		MIGRATION_BEFORE_REPORT="$backup_dir/migration-probe-before.json" \
		MIGRATION_AFTER_REPORT="$backup_dir/migration-probe-after.json" \
		node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createDatabase, CURRENT_SCHEMA_VERSION } from './src/db.js';

function quoteIdentifier(value) {
	return `"${value.replaceAll('"', '""')}"`;
}

function inspectDatabase(database) {
	const integrity = database.prepare('PRAGMA integrity_check').all().map((row) => String(Object.values(row)[0]));
	if (integrity.length !== 1 || integrity[0] !== 'ok') {
		throw new Error(`SQLite integrity_check failed: ${integrity.join(', ')}`);
	}
	const schema = database.prepare(`
		SELECT type, name, tbl_name AS tableName, sql
		FROM sqlite_schema
		WHERE name NOT LIKE 'sqlite_%'
		ORDER BY type, name
	`).all();
	const tableCounts = Object.fromEntries(schema
		.filter((entry) => entry.type === 'table' && entry.sql)
		.map((entry) => [entry.name, Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(entry.name)}`).get().count)]));
	return {
		integrity,
		userVersion: Number(database.prepare('PRAGMA user_version').get().user_version),
		schema,
		tableCounts,
	};
}

const beforeDatabase = new Database(process.env.DATABASE_PATH, { readonly: true, fileMustExist: true });
const before = inspectDatabase(beforeDatabase);
beforeDatabase.close();
writeFileSync(process.env.MIGRATION_BEFORE_REPORT, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 });

const migratedDatabase = createDatabase(process.env.DATABASE_PATH);
const after = inspectDatabase(migratedDatabase);
migratedDatabase.close();
writeFileSync(process.env.MIGRATION_AFTER_REPORT, `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });

if (after.userVersion !== CURRENT_SCHEMA_VERSION) {
	throw new Error(`Unexpected schema version ${after.userVersion}; expected ${CURRENT_SCHEMA_VERSION}`);
}
const afterSchemaObjects = new Set(after.schema.map((entry) => `${entry.type}:${entry.name}`));
for (const entry of before.schema) {
	if (!afterSchemaObjects.has(`${entry.type}:${entry.name}`)) {
		throw new Error(`Migration removed existing schema object ${entry.type}:${entry.name}`);
	}
}
for (const [table, count] of Object.entries(before.tableCounts)) {
	if (after.tableCounts[table] !== count) {
		throw new Error(`Migration changed persistent table count for ${table}: ${count} -> ${after.tableCounts[table]}`);
	}
}
NODE
	)
}

assert_service_stopped() {
	local main_pid
	if systemctl is-active --quiet "$service"; then
		printf 'Refusing database restore while %s is active.\n' "$service" >&2
		return 1
	fi
	main_pid="$(systemctl show --property=MainPID --value "$service")"
	if test "${main_pid:-0}" != 0; then
		printf 'Refusing database restore while %s still has MainPID %s.\n' "$service" "$main_pid" >&2
		return 1
	fi
}

stop_service() {
	systemctl stop "$service"
	assert_service_stopped
}

create_activation_database_snapshot() {
	assert_service_stopped
	test -f "$data_db"
	test ! -e "$activation_db_snapshot"
	stat -c '%u' "$data_db" > "$activation_db_owner"
	stat -c '%g' "$data_db" > "$activation_db_group"
	stat -c '%a' "$data_db" > "$activation_db_mode"

	node - "$data_db" "$activation_db_snapshot" <<'NODE'
const Database = require('/opt/homepage-api/current/node_modules/better-sqlite3');
const [source, destination] = process.argv.slice(2);
const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true });
(async () => {
	try {
		const sourceIntegrity = sourceDatabase.pragma('integrity_check', { simple: true });
		if (sourceIntegrity !== 'ok') throw new Error(`Source integrity_check failed: ${sourceIntegrity}`);
		await sourceDatabase.backup(destination);
	} finally {
		sourceDatabase.close();
	}
	const snapshotDatabase = new Database(destination, { readonly: true, fileMustExist: true });
	try {
		const snapshotIntegrity = snapshotDatabase.pragma('integrity_check', { simple: true });
		if (snapshotIntegrity !== 'ok') throw new Error(`Snapshot integrity_check failed: ${snapshotIntegrity}`);
	} finally {
		snapshotDatabase.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
NODE
	chown root:root "$activation_db_snapshot" "$activation_db_owner" "$activation_db_group" "$activation_db_mode"
	chmod 600 "$activation_db_snapshot" "$activation_db_owner" "$activation_db_group" "$activation_db_mode"
}

create_activation_upload_snapshot() {
	assert_service_stopped
	test -d "$uploads_dir"
	test ! -e "$activation_upload_snapshot"
	test "$(stat -c '%d' "$uploads_dir")" = "$(stat -c '%d' "$backup_dir")"
	cp -al "$uploads_dir" "$activation_upload_snapshot"
}

restore_activation_database() {
	local owner group mode restore_path
	assert_service_stopped
	for required in "$activation_db_snapshot" "$activation_db_owner" "$activation_db_group" "$activation_db_mode"; do
		test -f "$required"
	done
	owner="$(cat "$activation_db_owner")"
	group="$(cat "$activation_db_group")"
	mode="$(cat "$activation_db_mode")"
	[[ "$owner" =~ ^[0-9]+$ ]]
	[[ "$group" =~ ^[0-9]+$ ]]
	[[ "$mode" =~ ^[0-7]{3,4}$ ]]
	restore_path="${data_dir}/.homepage-api.sqlite.restore-${release_id}-$$"
	rm -f "${data_db}-wal" "${data_db}-shm" "${data_db}-journal" "$restore_path"
	cp "$activation_db_snapshot" "$restore_path"
	chown "${owner}:${group}" "$restore_path"
	chmod "$mode" "$restore_path"
	sync "$restore_path"
	mv -fT "$restore_path" "$data_db"
	rm -f "${data_db}-wal" "${data_db}-shm" "${data_db}-journal"
}

preserve_current_database_before_restore() {
	assert_service_stopped
	test -f "$data_db"
	test ! -e "$rollback_current_dir"
	install -d -m 700 "$rollback_current_dir"
	cp -p "$data_db" "$rollback_current_dir/homepage-api.sqlite"
	for sidecar in "${data_db}-wal" "${data_db}-shm" "${data_db}-journal"; do
		if test -f "$sidecar"; then cp -p "$sidecar" "$rollback_current_dir/$(basename "$sidecar")"; fi
	done
	printf '%s\n' "$rollback_current_dir" > "$backup_dir/last-rollback-current-data.txt"
}

restore_activation_uploads() {
	local restore_path
	assert_service_stopped
	test -d "$activation_upload_snapshot"
	test -d "$uploads_dir"
	test -d "$rollback_current_dir"
	test ! -e "$rollback_current_dir/uploads"
	test "$(stat -c '%d' "$uploads_dir")" = "$(stat -c '%d' "$rollback_current_dir")"
	restore_path="${data_dir}/.uploads.restore-${release_id}-$$"
	test ! -e "$restore_path"
	cp -al "$activation_upload_snapshot" "$restore_path"
	mv -T "$uploads_dir" "$rollback_current_dir/uploads"
	mv -T "$restore_path" "$uploads_dir"
}

atomic_restore_environment() {
	local restore_path="$(dirname "$env_file")/.homepage-api.env.restore-${release_id}-$$"
	test -f "$backup_dir/homepage-api.env.pre"
	rm -f "$restore_path"
	cp --preserve=mode,ownership,timestamps "$backup_dir/homepage-api.env.pre" "$restore_path"
	mv -fT "$restore_path" "$env_file"
}

update_service_revision() {
	local updated_path="${env_file}.release-${release_id}.tmp"
	rm -f "$updated_path"
	cp --preserve=mode,ownership,timestamps "$env_file" "$updated_path"
	if grep -q '^SERVICE_REVISION=' "$updated_path"; then
		sed -i "s/^SERVICE_REVISION=.*/SERVICE_REVISION=${revision}/" "$updated_path"
	else
		printf '\nSERVICE_REVISION=%s\n' "$revision" >> "$updated_path"
	fi
	mv -fT "$updated_path" "$env_file"
}

rollback_to_previous() {
	local expected_revision="$1"
	local restore_database="$2"
	(
		set -Eeuo pipefail
		trap - ERR
		stop_service
		if test "$restore_database" = 1; then
			preserve_current_database_before_restore
			restore_activation_database
			restore_activation_uploads
		fi
		atomic_restore_environment
		ln -sfnT "$releases_root/$previous_release" /opt/homepage-api/current
		ln -sfnT "$release_dir" /opt/homepage-api/previous
		systemctl start "$service"
		systemctl is-active --quiet "$service"
		verify_health "$expected_revision"
	)
}

prepare_release() {
	test -d "$staging"
	test ! -e "$release_dir"
	test ! -e "$backup_dir"
	test -f "$staging/$archive"
	test -f "$staging/release-manifest-${release_id}.json"
	test -f "$staging/SHA256SUMS"
	test -f "$staging/deploy-api.sh"
	test "$(sha256sum "$staging/$archive" | awk '{print $1}')" = "$archive_sha"

	install -d -o homepage-api -g homepage-api -m 755 "$release_dir"
	tar -xzf "$staging/$archive" -C "$release_dir"
	test -f "$release_dir/package.json"
	test -f "$release_dir/package-lock.json"
	test -d "$release_dir/src"
	test -d "$release_dir/test"
	chown -R homepage-api:homepage-api "$release_dir"
	install -d -m 700 "$release_dir/.release"
	cp "$staging/$archive" "$staging/release-manifest-${release_id}.json" "$staging/SHA256SUMS" "$staging/deploy-api.sh" "$release_dir/.release/"
	chmod 700 "$release_dir/.release/deploy-api.sh"

	(
		cd "$release_dir"
		runuser -u homepage-api -- env HOME=/opt/homepage-api npm ci --omit=dev
		runuser -u homepage-api -- env HOME=/opt/homepage-api npm test
		runuser -u homepage-api -- env HOME=/opt/homepage-api npm audit --omit=dev --audit-level=high
	)

	verify_runtime_config "$release_dir"
	backup_persistent_data
	run_migration_probe

	printf 'PREPARED api release=%s revision=%s\n' "$release_id" "$revision"
}

activate_release() {
	test -d "$release_dir"
	test -f "$backup_dir/homepage-api.env.pre"
	test -f "$backup_dir/previous-revision.txt"
	test "$(basename "$(readlink -f /opt/homepage-api/current)")" = "$previous_release"
	cmp -s "$env_file" "$backup_dir/homepage-api.env.pre"
	verify_runtime_config "$release_dir"
	local previous_revision database_restore_required
	previous_revision="$(cat "$backup_dir/previous-revision.txt")"
	test -n "$previous_revision"
	database_restore_required=0

	rollback_on_error() {
		local status="$1" rollback_status
		trap - ERR
		set +e
		rollback_to_previous "$previous_revision" "$database_restore_required"
		rollback_status=$?
		set -e
		if test "$rollback_status" -ne 0; then
			printf 'CRITICAL: API activation failed and safe rollback also failed; service remains stopped unless old readiness was proven.\n' >&2
			exit 70
		fi
		if test "$database_restore_required" = 0; then
			rm -f "$activation_db_snapshot" "$activation_db_owner" "$activation_db_group" "$activation_db_mode"
		fi
		exit "$status"
	}
	trap 'rollback_on_error $?' ERR
	stop_service
	create_activation_database_snapshot
	create_activation_upload_snapshot
	database_restore_required=1
	update_service_revision
	ln -sfnT "$releases_root/$previous_release" /opt/homepage-api/previous
	ln -sfnT "$release_dir" /opt/homepage-api/current
	systemctl start "$service"
	systemctl is-active --quiet "$service"
	verify_health "$revision"
	trap - ERR
	printf 'ACTIVATED api release=%s previous=%s\n' "$release_id" "$previous_release"
}

rollback_release() {
	test -d "$backup_dir"
	test -f "$backup_dir/homepage-api.env.pre"
	test -f "$backup_dir/previous-revision.txt"
	test "$(basename "$(readlink -f /opt/homepage-api/current)")" = "$release_id"
	local previous_revision
	previous_revision="$(cat "$backup_dir/previous-revision.txt")"
	test -n "$previous_revision"
	rollback_to_previous "$previous_revision" 1
	printf 'ROLLED_BACK api release=%s restored=%s\n' "$release_id" "$previous_release"
}

case "$mode" in
	prepare) prepare_release ;;
	activate) activate_release ;;
	rollback) rollback_release ;;
	*) printf 'Unknown mode: %s\n' "$mode" >&2; exit 64 ;;
esac
