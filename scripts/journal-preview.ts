import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { readHumanAgencyPackage } from '../src/lib/humanAgencyContract.js';

const args = process.argv.slice(2);
const packageIndex = args.indexOf('--package');
const packagePath = packageIndex >= 0 ? args[packageIndex + 1] : undefined;
if (!packagePath) throw new Error('Usage: npm run journal:preview -- --package <approved-preview.package.json>');

const absolutePackage = resolve(packagePath);
const exchange = await readHumanAgencyPackage(absolutePackage, new Set(['approved-preview', 'approved-publish']));
process.stdout.write(`Starting real /blog/digested/ preview with ${exchange.entries.length} approved Journal article${exchange.entries.length === 1 ? '' : 's'}.\n`);

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmExecutable, ['run', 'dev', '--', '--host', '127.0.0.1'], {
	stdio: 'inherit',
	env: { ...process.env, JOURNAL_PREVIEW_PACKAGE: absolutePackage },
});

child.on('error', (error) => {
	throw error;
});
child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});
