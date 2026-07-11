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
env_file="/etc/homepage-api/homepage-api.env"
archive="homepage-api-${release_id}.tar.gz"
service="homepage-api.service"

verify_health() {
	local health
	health="$(curl -fsS http://127.0.0.1:8787/health)"
	printf '%s' "$health" | node -e '
		const fs = require("node:fs");
		const expectedRevision = process.argv[1];
		const health = JSON.parse(fs.readFileSync(0, "utf8"));
		if (!health.ok || health.revision !== expectedRevision || health.readiness?.database !== "ready") {
			throw new Error(`Unexpected API health: ${JSON.stringify(health)}`);
		}
	' "$revision"
}

backup_persistent_data() {
	test -f "$data_db"
	install -d -m 700 "$backup_dir"
	cp -p "$env_file" "$backup_dir/homepage-api.env.pre"
	printf '%s\n' "$previous_release" > "$backup_dir/previous-release.txt"

	node - "$data_db" "$backup_dir/homepage-api.pre.sqlite" <<'NODE'
const Database = require('/opt/homepage-api/current/node_modules/better-sqlite3');
const [source, destination] = process.argv.slice(2);
const database = new Database(source, { readonly: true });
database.backup(destination)
	.then(() => database.close())
	.catch((error) => {
		database.close();
		throw error;
	});
NODE

	tar -C "$data_dir" -czf "$backup_dir/uploads.tar.gz" uploads
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

	backup_persistent_data
	cp "$backup_dir/homepage-api.pre.sqlite" "$backup_dir/migration-probe.sqlite"
	(
		cd "$release_dir"
		DATABASE_PATH="$backup_dir/migration-probe.sqlite" node --input-type=module -e '
			import { createDatabase, CURRENT_SCHEMA_VERSION } from "./src/db.js";
			const database = createDatabase(process.env.DATABASE_PATH);
			const version = Number(database.prepare("PRAGMA user_version").get().user_version);
			database.close();
			if (version !== CURRENT_SCHEMA_VERSION) throw new Error(`Unexpected schema version ${version}`);
		'
	)

	printf 'PREPARED api release=%s revision=%s\n' "$release_id" "$revision"
}

activate_release() {
	test -d "$release_dir"
	test -f "$backup_dir/homepage-api.env.pre"
	test "$(basename "$(readlink -f /opt/homepage-api/current)")" = "$previous_release"

	if grep -q '^SERVICE_REVISION=' "$env_file"; then
		sed -i "s/^SERVICE_REVISION=.*/SERVICE_REVISION=${revision}/" "$env_file"
	else
		printf '\nSERVICE_REVISION=%s\n' "$revision" >> "$env_file"
	fi

	rollback_on_error() {
		status=$?
		ln -sfn "$previous_release" /opt/homepage-api/current || true
		cp "$backup_dir/homepage-api.env.pre" "$env_file" || true
		systemctl restart "$service" || true
		exit "$status"
	}
	trap rollback_on_error ERR
	ln -sfn "$previous_release" /opt/homepage-api/previous
	ln -sfn "$release_id" /opt/homepage-api/current
	systemctl restart "$service"
	systemctl is-active --quiet "$service"
	verify_health
	trap - ERR
	printf 'ACTIVATED api release=%s previous=%s\n' "$release_id" "$previous_release"
}

rollback_release() {
	test -d "$backup_dir"
	test -f "$backup_dir/homepage-api.env.pre"
	ln -sfn "$previous_release" /opt/homepage-api/current
	ln -sfn "$release_id" /opt/homepage-api/previous
	cp "$backup_dir/homepage-api.env.pre" "$env_file"
	systemctl restart "$service"
	systemctl is-active --quiet "$service"
	printf 'ROLLED_BACK api release=%s restored=%s\n' "$release_id" "$previous_release"
}

case "$mode" in
	prepare) prepare_release ;;
	activate) activate_release ;;
	rollback) rollback_release ;;
	*) printf 'Unknown mode: %s\n' "$mode" >&2; exit 64 ;;
esac
