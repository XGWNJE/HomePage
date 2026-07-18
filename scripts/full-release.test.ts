import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const fullPublisher = readFileSync('scripts/publish-full.ps1', 'utf8');
const apiHelper = readFileSync('.agents/skills/deploy-homepage/scripts/deploy-api.sh', 'utf8');
const frontendHelper = readFileSync('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh', 'utf8');
const preflight = readFileSync('.agents/skills/deploy-homepage/scripts/preflight.ps1', 'utf8');

test('full release preserves versioned frontend and API rollback boundaries', () => {
	assert.ok(existsSync('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh'));
	assert.match(fullPublisher, /Full publishing requires a clean worktree/);
	assert.match(fullPublisher, /'ci', '--prefix', 'server'/);
	assert.match(fullPublisher, /-Mode', 'FullAudit'/);
	assert.doesNotMatch(fullPublisher, /SkipPreflight/);
	assert.doesNotMatch(preflight, /SkipVerify/);
	assert.match(preflight, /'VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH'/);
	assert.doesNotMatch(preflight, /SSH_PASSWORD/);
	assert.match(fullPublisher, /deploy-frontend\.sh/);
	assert.match(fullPublisher, /deploy-api\.sh/);
	assert.match(fullPublisher, /nginx -t >\/dev\/null 2>\/dev\/null/);
	assert.match(fullPublisher, /frontendRelease=%s/);
	assert.match(fullPublisher, /Unable to read the current frontend and API release identifiers/);
	assert.match(fullPublisher, /visionguard\.xgwnje\.cn\/' -ExpectedStatus 404/);
	assert.match(fullPublisher, /-Command \$maintainCommand/);
	assert.match(fullPublisher, /-Scope @\('anytls','homepage','homepage-api','visionguard'\)/);
	assert.match(apiHelper, /better-sqlite3/);
	assert.match(apiHelper, /migration-probe\.sqlite/);
	assert.match(apiHelper, /migration-probe-before\.json/);
	assert.match(apiHelper, /migration-probe-after\.json/);
	assert.match(apiHelper, /PRAGMA integrity_check/);
	assert.match(apiHelper, /FROM sqlite_schema/);
	assert.match(apiHelper, /tableCounts/);
	assert.match(apiHelper, /SERVICE_REVISION/);
	assert.match(apiHelper, /release_dir\/\.release/);
	assert.match(apiHelper, /ln -sfnT "\$release_dir" \/opt\/homepage-api\/current/);
	assert.match(apiHelper, /ln -sfnT "\$releases_root\/\$previous_release" \/opt\/homepage-api\/current/);
	assert.match(apiHelper, /for attempt in \$\(seq 1 15\)/);
	assert.match(apiHelper, /rollback_release/);
	assert.match(apiHelper, /systemctl show --property=MainPID --value/);
	assert.match(apiHelper, /\/proc\/\$\{main_pid\}\/environ/);
	assert.match(apiHelper, /loadConfig\(runtimeEnv\)/);
	assert.match(apiHelper, /resolve\(config\.dataDir\)/);
	assert.match(apiHelper, /resolve\(config\.databasePath\)/);
	assert.match(apiHelper, /resolve\(config\.uploadDir\)/);
	assert.match(apiHelper, /String\(config\.port\)/);
	assert.match(apiHelper, /Refusing database restore while %s is active/);
	assert.match(apiHelper, /homepage-api\.activation-pre\.sqlite/);
	assert.match(apiHelper, /uploads\.activation-pre/);
	assert.match(apiHelper, /rm -f "\$\{data_db\}-wal" "\$\{data_db\}-shm" "\$\{data_db\}-journal"/);
	assert.match(apiHelper, /chown "\$\{owner\}:\$\{group\}" "\$restore_path"/);
	assert.match(apiHelper, /chmod "\$mode" "\$restore_path"/);
	assert.match(apiHelper, /mv -fT "\$restore_path" "\$data_db"/);
	assert.match(apiHelper, /rollback-current-\$\(date -u/);
	assert.match(apiHelper, /preserve_current_database_before_restore\n\t\t\trestore_activation_database\n\t\t\trestore_activation_uploads/);
	assert.match(apiHelper, /trap 'rollback_on_error \$\?' ERR/);
	assert.match(apiHelper, /local status="\$1" rollback_status/);
	assert.match(apiHelper, /rollback_to_previous "\$previous_revision"/);
	assert.match(apiHelper, /verify_health "\$expected_revision"/);
	assert.ok(
		apiHelper.indexOf('stop_service\n\tcreate_activation_database_snapshot')
		< apiHelper.indexOf('ln -sfnT "$release_dir" /opt/homepage-api/current'),
		'activation must stop the service and snapshot SQLite before switching current',
	);
	assert.doesNotMatch(apiHelper, /systemctl restart/);
	assert.match(fullPublisher, /\$apiActivated = \$true\s+Test-ApiHealth -Revision \$head\s+Invoke-Remote -Command \$frontendActivate/);
	assert.doesNotMatch(fullPublisher, /Invoke-Remote -Command \$apiRollback/);
	assert.match(fullPublisher, /The healthy API was preserved to avoid data loss/);
	assert.match(frontendHelper, /grep -F "  \$archive" SHA256SUMS \| sha256sum -c -/);
	assert.match(frontendHelper, /grep -F "  \$manifest" SHA256SUMS \| sha256sum -c -/);
});

test('embedded API release Node probes are syntactically valid', () => {
	const programs = [...apiHelper.matchAll(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/gu)].map((match) => match[1]);
	assert.equal(programs.length, 3);
	for (const program of programs) {
		const result = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
			encoding: 'utf8',
			input: program,
		});
		assert.equal(result.status, 0, result.stderr);
	}
});
