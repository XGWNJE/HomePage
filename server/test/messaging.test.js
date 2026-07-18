import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('a missing sendmail executable does not terminate the API process', () => {
	const program = `
		import { trySendmail } from './src/internal/messaging.js';
		trySendmail(
			{ enableSendmail: true, sendmailPath: 'Z:\\\\definitely-missing\\\\sendmail.exe' },
			'user@example.com',
			'Subject',
			'Body',
		);
		setTimeout(() => console.log('process-alive'), 100);
	`;
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
		cwd: process.cwd(),
		encoding: 'utf8',
		timeout: 5_000,
	});

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /process-alive/);
});
