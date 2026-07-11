import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const fullPublisher = readFileSync('scripts/publish-full.ps1', 'utf8');
const apiHelper = readFileSync('.agents/skills/deploy-homepage/scripts/deploy-api.sh', 'utf8');
const frontendHelper = readFileSync('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh', 'utf8');

test('full release preserves versioned frontend and API rollback boundaries', () => {
	assert.ok(existsSync('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh'));
	assert.match(fullPublisher, /Full publishing requires a clean worktree/);
	assert.match(fullPublisher, /'ci', '--prefix', 'server'/);
	assert.match(fullPublisher, /-Mode', 'FullAudit'/);
	assert.match(fullPublisher, /deploy-frontend\.sh/);
	assert.match(fullPublisher, /deploy-api\.sh/);
	assert.match(fullPublisher, /nginx -t >\/dev\/null 2>\/dev\/null/);
	assert.match(fullPublisher, /frontendRelease=%s/);
	assert.match(fullPublisher, /Unable to read the current frontend and API release identifiers/);
	assert.match(fullPublisher, /visionguard\.xgwnje\.cn\/' -ExpectedStatus 404/);
	assert.match(fullPublisher, /AfterChange -Scope anytls,homepage,homepage-api,visionguard/);
	assert.match(apiHelper, /better-sqlite3/);
	assert.match(apiHelper, /migration-probe\.sqlite/);
	assert.match(apiHelper, /SERVICE_REVISION/);
	assert.match(apiHelper, /release_dir\/\.release/);
	assert.match(apiHelper, /ln -sfnT "\$release_dir" \/opt\/homepage-api\/current/);
	assert.match(apiHelper, /ln -sfnT "\$releases_root\/\$previous_release" \/opt\/homepage-api\/current/);
	assert.match(apiHelper, /for attempt in \$\(seq 1 15\)/);
	assert.match(apiHelper, /rollback_release/);
	assert.match(frontendHelper, /grep -F "  \$archive" SHA256SUMS \| sha256sum -c -/);
	assert.match(frontendHelper, /grep -F "  \$manifest" SHA256SUMS \| sha256sum -c -/);
});
