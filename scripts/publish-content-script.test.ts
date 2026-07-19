import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('./publish-content.mjs', import.meta.url);

test('content release transports remote scripts through bash stdin', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /'bash', '-s'/u);
	assert.match(source, /child\.stdin\.write/u);
	assert.match(source, /input\.replaceAll\('\\r', ''\)/u);
	assert.doesNotMatch(source, /'bash', '-c'/u);
});

test('content release separates bundle upload and reports phase timings', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /scp\.exe/u);
	assert.match(source, /buildAndBundleSeconds/u);
	assert.match(source, /uploadSeconds/u);
	assert.match(source, /activateSeconds/u);
	assert.match(source, /afterChangeSeconds/u);
});

test('content release builds the main checkout directly without an isolated worktree', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.doesNotMatch(source, /content-release-worktree|isolatedProjectRoot|publish-content\.ps1/u);
	assert.match(source, /content-release-scope\.mjs/u);
	assert.match(source, /content-release-links\.mjs/u);
	assert.match(source, /content-delta\.mjs/u);
	assert.match(source, /check-language-pairs\.mjs/u);
	assert.match(source, /ensure-sitemap-xml\.mjs/u);
	assert.equal(source.match(/astro\.mjs/gu)?.length, 1);
	assert.doesNotMatch(source, /preflight\.ps1|test:content-release|npm run verify/u);
});

test('content release gates on a content-only diff against the production revision', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /classifyContentReleasePaths/u);
	assert.match(source, /\$\{productionRevision\}\.\.HEAD/u);
	assert.match(source, /selectContentReleasePaths/u);
	assert.match(source, /use a frontend or full release/u);
	assert.doesNotMatch(source, /CONTENT_RELEASE_WORKTREE_PATHS_JSON|CONTENT_RELEASE_PATHS_JSON|CONTENT_RELEASE_LINK_ROUTES_JSON/u);
});
