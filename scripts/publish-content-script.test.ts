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
