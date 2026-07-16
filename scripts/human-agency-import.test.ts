import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { applyHumanAgencyImport, planHumanAgencyImport } from './human-agency-import.js';

const fixtures = resolve('tests', 'fixtures', 'human-agency');

test('import is dry-run by default and only accepts approved-publish packages', async (context) => {
	const contentDirectory = await mkdtemp(join(tmpdir(), 'human-agency-import-plan-'));
	context.after(() => rm(contentDirectory, { recursive: true, force: true }));
	await assert.rejects(
		planHumanAgencyImport(resolve(fixtures, 'valid', 'exchange-package.v1.json'), contentDirectory),
		/not allowed/,
	);
	const { plan } = await planHumanAgencyImport(
		resolve(fixtures, 'valid', 'exchange-package.publish.v1.json'),
		contentDirectory,
	);
	assert.equal(plan.items[0]?.action, 'create');
	assert.equal(plan.languageSummary.chineseMayStandAlone, true);
	await assert.rejects(readFile(plan.items[0]!.target, 'utf8'), /ENOENT/);
});

test('apply writes atomically and collisions require the exact old hash', async (context) => {
	const contentDirectory = await mkdtemp(join(tmpdir(), 'human-agency-import-apply-'));
	context.after(() => rm(contentDirectory, { recursive: true, force: true }));
	const packagePath = resolve(fixtures, 'valid', 'exchange-package.publish.v1.json');
	const first = await applyHumanAgencyImport(packagePath, contentDirectory);
	assert.equal(first.items[0]?.action, 'create');
	const target = first.items[0]!.target;
	const imported = JSON.parse(await readFile(target, 'utf8')) as { published_at: string; entry: { entry_hash: string } };
	assert.match(imported.published_at, /^\d{4}-\d{2}-\d{2}T/);
	await assert.rejects(applyHumanAgencyImport(packagePath, contentDirectory), /Import collision/);
	await assert.rejects(applyHumanAgencyImport(packagePath, contentDirectory, '0'.repeat(64)), /Import collision/);
	const replaced = await applyHumanAgencyImport(packagePath, contentDirectory, imported.entry.entry_hash);
	assert.equal(replaced.items[0]?.action, 'replace');
});
