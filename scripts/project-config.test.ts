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
	assert.equal(packageJson.scripts.postbuild, undefined);
	assert.equal(packageJson.scripts['test:content-reset'], undefined);
	assert.ok(packageJson.scripts.test);
	assert.match(packageJson.scripts.test, /npm run test:admin/);
	assert.equal(packageJson.scripts['test:admin'], 'node scripts/check-admin-page.mjs');
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

test('CI installs both package boundaries and runs the Node 22 verification gate', async () => {
	const workflow = await readFile(path.resolve('.github/workflows/ci.yml'), 'utf8');

	assert.match(workflow, /node-version:\s*22/);
	assert.match(workflow, /run:\s*npm ci\s*$/m);
	assert.match(workflow, /run:\s*npm ci --prefix server\s*$/m);
	assert.match(workflow, /run:\s*npm run verify\s*$/m);
});

test('Dependabot covers frontend, server, and workflow dependencies', async () => {
	const config = await readFile(path.resolve('.github/dependabot.yml'), 'utf8');

	assert.match(config, /package-ecosystem:\s*"npm"[\s\S]*directory:\s*"\/"/);
	assert.match(config, /package-ecosystem:\s*"npm"[\s\S]*directory:\s*"\/server"/);
	assert.match(config, /package-ecosystem:\s*"github-actions"/);
});

test('document auth bootstrap uses the shared API configuration', async () => {
	const head = await readFile(path.resolve('src/components/BaseHead.astro'), 'utf8');

	assert.match(head, /import \{ API_BASE, TOKEN_KEY \} from ['"]\.\.\/lib\/config['"]/);
	assert.match(head, /define:vars=\{\{ API_BASE, TOKEN_KEY \}\}/);
	assert.doesNotMatch(head, /isLocalhost\s*\?/);
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

	assert.match(skill, /^---\r?\nname: deploy-homepage\r?\ndescription: .*Use when/m);
	assert.match(skill, /D:\\ObjectCode\\Server-infra/);
	assert.match(skill, /npm run verify/);
	assert.match(skill, /真实 Chrome/);
	assert.match(contract, /SQLite.*backup/is);
	assert.match(contract, /nginx -t/);
	assert.match(contract, /明确授权.*Nginx/s);
	assert.match(contract, /current.*previous/s);
	assert.match(contract, /worktree-<server-sha12>/);
	assert.doesNotMatch(`${skill}\n${contract}\n${preflight}`, /212\.135\.41\.88/);
	assert.doesNotMatch(`${skill}\n${contract}\n${preflight}`, /SSH_PASSWORD\s*=/);
});
