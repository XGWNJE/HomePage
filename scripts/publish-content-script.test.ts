import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('./publish-content.ps1', import.meta.url);

test('content release transports remote scripts through bash stdin', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /@\(\$sshTarget, 'bash', '-s'\)\) -RedirectInput/u);
	assert.match(source, /Send-ProcessInput -Handle \$snapshotHandle -Value \$snapshotCommand/u);
	assert.match(source, /Send-ProcessInput -Handle \$uploadHandle -Value \$remoteCommand/u);
	assert.doesNotMatch(source, /@\(\$sshTarget, \$snapshotCommand\)/u);
	assert.doesNotMatch(source, /@\(\$sshTarget, \$remoteCommand\)/u);
});

test('content release separates bundle upload and reports phase timings', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /Invoke-Native -FilePath 'scp\.exe'/u);
	assert.match(source, /buildAndBundleSeconds =/u);
	assert.match(source, /uploadSeconds =/u);
	assert.match(source, /activateSeconds =/u);
	assert.match(source, /afterChangeSeconds =/u);
});

test('content and benchmark releases keep the direct one-build article hot path', async () => {
	const source = await readFile(scriptUrl, 'utf8');

	assert.match(source, /content-release-worktree\.mjs/u);
	assert.match(source, /content-release-links\.mjs/u);
	assert.match(source, /\$isolatedProjectRoot/u);
	assert.match(source, /if \(-not \$PlanOnly\)[\s\S]*?scripts\\check-language-pairs\.mjs/u);
	assert.match(source, /node_modules\\\.bin\\astro\.cmd[\s\S]*?WorkingDirectory[\s\S]*?\$isolatedProjectRoot/u);
	assert.match(source, /scripts\\ensure-sitemap-xml\.mjs/u);
	assert.equal(source.match(/node_modules\\\.bin\\astro\.cmd/gu)?.length, 1);
	assert.doesNotMatch(source, /preflight\.ps1|-Mode', 'ContentOnly'|test:content-release|npm run verify/u);
});
