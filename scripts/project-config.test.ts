import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const configUrl = pathToFileURL(path.resolve('astro.config.mjs'));
let importSequence = 0;

async function loadConfig(env: Record<string, string | undefined>) {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	try {
		const url = new URL(configUrl);
		url.searchParams.set('test', String(importSequence++));
		return (await import(url.href)).default;
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test('ordinary GitHub Actions builds keep the VPS root base', async () => {
	const config = await loadConfig({
		NODE_ENV: 'production',
		GITHUB_ACTIONS: 'true',
		DEPLOY_TARGET: undefined,
	});

	assert.equal(config.base, '/');
});

test('legacy platform environment values cannot change the VPS root base', async () => {
	const config = await loadConfig({
		NODE_ENV: 'production',
		GITHUB_ACTIONS: 'true',
		DEPLOY_TARGET: 'github-pages',
	});

	assert.equal(config.base, '/');
});

test('the root package owns frontend tooling and delegates API commands to server', async () => {
	const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
	const serverPackageJson = JSON.parse(await readFile(path.resolve('server/package.json'), 'utf8'));
	const serverOnlyDependencies = ['better-sqlite3', 'busboy', 'cookie', 'express'];

	assert.equal(packageJson.name, 'xgwnje-homepage');
	assert.equal(packageJson.private, true);
	assert.match(packageJson.engines.node, /22\.12/);
	assert.match(packageJson.engines.npm, /10/);
	assert.equal(packageJson.scripts['api:dev'], 'npm --prefix server start');
	assert.equal(packageJson.scripts['test:api'], 'npm --prefix server test');
	assert.equal(packageJson.scripts['publish:content'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-content.ps1');
	assert.match(packageJson.scripts['content:check'], /test:content-release/);
	assert.equal(packageJson.scripts['clean:local'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/clean-local.ps1');
	assert.equal(packageJson.scripts.postbuild, undefined);
	assert.equal(packageJson.scripts['test:content-reset'], undefined);
	assert.ok(packageJson.scripts.test);
	assert.match(packageJson.scripts.test, /npm run test:admin/);
	assert.equal(
		packageJson.scripts['test:admin'],
		'node scripts/check-admin-page.mjs && node scripts/check-admin-subscriptions.mjs',
	);
	assert.ok(packageJson.scripts.typecheck);
	assert.match(packageJson.scripts.typecheck, /astro check/);
	assert.ok(packageJson.scripts.verify);
	for (const dependency of serverOnlyDependencies) {
		assert.equal(packageJson.dependencies[dependency], undefined, `${dependency} belongs to server/package.json`);
		assert.ok(serverPackageJson.dependencies[dependency], `${dependency} must remain in server/package.json`);
	}
	assert.match(serverPackageJson.engines.node, /20\.18/);
	assert.match(serverPackageJson.engines.npm, /10/);
});

test('CI separates content, frontend, API, and explicit full-audit gates', async () => {
	const frontend = await readFile(path.resolve('.github/workflows/ci.yml'), 'utf8');
	const content = await readFile(path.resolve('.github/workflows/content-ci.yml'), 'utf8');
	const api = await readFile(path.resolve('.github/workflows/api-ci.yml'), 'utf8');
	const audit = await readFile(path.resolve('.github/workflows/full-audit.yml'), 'utf8');

	for (const workflow of [frontend, content, api, audit]) assert.match(workflow, /node-version:\s*22/);
	assert.match(frontend, /run:\s*npm test\s*$/m);
	assert.match(frontend, /run:\s*npm run typecheck\s*$/m);
	assert.match(frontend, /run:\s*npm run build\s*$/m);
	assert.doesNotMatch(frontend, /npm ci --prefix server/);
	assert.match(content, /src\/content\/blog\/\*\*/);
	assert.match(content, /run:\s*npm run content:check\s*$/m);
	assert.match(api, /run:\s*npm ci --prefix server\s*$/m);
	assert.match(api, /run:\s*npm --prefix server test\s*$/m);
	assert.match(audit, /workflow_dispatch/);
	assert.match(audit, /run:\s*npm run verify\s*$/m);
});

test('Dependabot covers frontend, server, and workflow dependencies', async () => {
	const config = await readFile(path.resolve('.github/dependabot.yml'), 'utf8');

	assert.match(config, /package-ecosystem:\s*"npm"[\s\S]*directory:\s*"\/"/);
	assert.match(config, /package-ecosystem:\s*"npm"[\s\S]*directory:\s*"\/server"/);
	assert.match(config, /package-ecosystem:\s*"github-actions"/);
});

test('document auth bootstrap uses the shared API configuration', async () => {
	const head = await readFile(path.resolve('src/components/BaseHead.astro'), 'utf8');
	const siteAuth = await readFile(path.resolve('src/client/site/auth.ts'), 'utf8');

	assert.match(head, /startSiteRuntime/);
	assert.match(siteAuth, /from ['"]\.\.\/\.\.\/lib\/auth['"]/);
	assert.match(siteAuth, /import \{ API_BASE \} from ['"]\.\.\/\.\.\/lib\/config['"]/);
	assert.match(siteAuth, /window\.__API_BASE = API_BASE/);
	assert.doesNotMatch(`${head}\n${siteAuth}`, /isLocalhost\s*\?/);
});

test('the project release skill preserves production safety gates', async () => {
	const skill = await readFile(path.resolve('.agents/skills/deploy-homepage/SKILL.md'), 'utf8');
	const contract = await readFile(
		path.resolve('.agents/skills/deploy-homepage/references/release-contract.md'),
		'utf8',
	);
	const preflight = await readFile(
		path.resolve('.agents/skills/deploy-homepage/scripts/preflight.ps1'),
		'utf8',
	);
	const contentPublisher = await readFile(path.resolve('scripts/publish-content.ps1'), 'utf8');
	const fullPublisher = await readFile(path.resolve('scripts/publish-full.ps1'), 'utf8');
	const remoteFrontend = await readFile(
		path.resolve('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh'),
		'utf8',
	);

	assert.match(skill, /^---\r?\nname: deploy-homepage\r?\ndescription: .*Use when/m);
	assert.match(skill, /D:\\ObjectCode\\Server-infra/);
	assert.match(skill, /FastFrontend/);
	assert.match(skill, /ContentOnly/);
	assert.match(skill, /FullAudit/);
	assert.match(skill, /-Mode FastFrontend/);
	assert.match(skill, /-Mode FullAudit/);
	assert.match(skill, /真实 Chrome/);
	assert.match(preflight, /ValidateSet\('ContentOnly', 'FastFrontend', 'FullAudit'\)/);
	assert.match(preflight, /@\('npm run verify'\)/);
	assert.match(preflight, /npm run content:check/);
	assert.match(preflight, /npm run test:ui-reuse/);
	assert.match(preflight, /npm run typecheck/);
	assert.match(preflight, /npm run build/);
	assert.match(contract, /所有档位共同的安全底线/);
	assert.match(contract, /AfterChange/);
	assert.match(contract, /SQLite.*backup/is);
	assert.match(contract, /nginx -t/);
	assert.match(contract, /明确授权.*Nginx/s);
	assert.match(contract, /current.*previous/s);
	assert.match(contract, /worktree-<server-sha12>/);
	assert.match(contentPublisher, /productionRevision\.\.HEAD/);
	assert.match(contentPublisher, /ls-remote --heads origin refs\/heads\/main/);
	assert.match(contentPublisher, /Content fast lane rejected/);
	assert.match(contentPublisher, /StrictHostKeyChecking=yes/);
	assert.match(contentPublisher, /-Mode AfterChange -Scope homepage,homepage-api/);
	assert.match(contentPublisher, /Invoke-Remote -Command \$rollback/);
	assert.match(fullPublisher, /'package\.json', 'package-lock\.json', 'scripts', 'src', 'test'/);
	assert.match(fullPublisher, /-Command \$maintainCommand/);
	assert.match(fullPublisher, /@\('anytls','homepage','homepage-api','visionguard'\)/);
	assert.match(remoteFrontend, /grep -F "  \$archive" SHA256SUMS \| sha256sum -c -/);
	assert.match(remoteFrontend, /grep -F "  \$manifest" SHA256SUMS \| sha256sum -c -/);
	assert.match(remoteFrontend, /rollback_on_error/);
	assert.match(remoteFrontend, /ln -sfn "\$release_id" "\$releases_root\/current"/);
	assert.doesNotMatch(`${skill}\n${contract}\n${preflight}`, /212\.135\.41\.88/);
	assert.doesNotMatch(`${skill}\n${contract}\n${preflight}\n${contentPublisher}`, /SSH_PASSWORD\s*=/);
});

test('local cleanup stays inside the repository and preserves persistent data', async () => {
	const cleanup = await readFile(path.resolve('scripts/clean-local.ps1'), 'utf8');

	assert.match(cleanup, /GetFullPath/);
	assert.match(cleanup, /StartsWith\(\$rootPrefix/);
	assert.match(cleanup, /server-data/);
	assert.doesNotMatch(cleanup, /Remove-Item[^\r\n]*server-data/);
});
