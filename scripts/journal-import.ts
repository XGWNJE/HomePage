import { resolve } from 'node:path';

import { applyHumanAgencyImport, planHumanAgencyImport } from './human-agency-import.js';

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);
const packagePath = value('package');
if (!packagePath) throw new Error('Usage: npm run journal:import -- --package <path> [--apply] [--expected-old-hash <sha256>]');
if (has('dry-run') && has('apply')) throw new Error('--dry-run and --apply are mutually exclusive.');

const contentDirectory = resolve('src', 'content', 'human-agency');
const expectedOldHash = value('expected-old-hash');
const plan = has('apply')
	? await applyHumanAgencyImport(packagePath, contentDirectory, expectedOldHash)
	: (await planHumanAgencyImport(packagePath, contentDirectory, expectedOldHash)).plan;

process.stdout.write(
	`${JSON.stringify({ mode: has('apply') ? 'apply' : 'dry-run', ...plan }, null, 2)}\n`,
);
