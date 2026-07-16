import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { loadHumanAgencyEntries } from '../src/content/humanAgencyLoader.js';
import { readHumanAgencyPackage, verifyHumanAgencyPackage } from '../src/lib/humanAgencyContract.js';

const fixtures = resolve('tests', 'fixtures', 'human-agency');

test('consumer accepts the shared valid v1 preview fixture', async () => {
	const exchange = await readHumanAgencyPackage(
		resolve(fixtures, 'valid', 'exchange-package.v1.json'),
		new Set(['approved-preview']),
	);
	assert.equal(exchange.schema_version, '1.0.0');
	assert.equal(exchange.entries.length, 1);
});

test('consumer rejects old, unapproved, and hash-mismatched packages', async () => {
	await assert.rejects(
		readHumanAgencyPackage(resolve(fixtures, 'invalid', 'exchange-package.old-version.json')),
		/Invalid human-agency exchange package/,
	);
	await assert.rejects(
		readHumanAgencyPackage(resolve(fixtures, 'invalid', 'exchange-package.unapproved.json')),
		/Invalid human-agency exchange package/,
	);
	await assert.rejects(
		readHumanAgencyPackage(resolve(fixtures, 'invalid', 'exchange-package.bad-hash.json')),
		/Entry hash mismatch/,
	);
});

test('explicit preview loader never falls back to an unapproved or relative package path', async (context) => {
	const contentDirectory = await mkdtemp(join(tmpdir(), 'human-agency-content-'));
	context.after(() => rm(contentDirectory, { recursive: true, force: true }));
	assert.deepEqual(await loadHumanAgencyEntries({ contentDirectory }), []);
	await assert.rejects(
		loadHumanAgencyEntries({ contentDirectory, previewPackage: 'relative-preview.json' }),
		/absolute path/,
	);
	const entries = await loadHumanAgencyEntries({
		contentDirectory,
		previewPackage: resolve(fixtures, 'valid', 'exchange-package.v1.json'),
	});
	assert.equal(entries[0]?.entry.slug, 'human-judgment-before-shipping');
	assert.equal(entries[0]?.publishedAt, '2026-07-16T00:00:00.000Z');
});

test('production loader independently checks an imported entry hash', async (context) => {
	const contentDirectory = await mkdtemp(join(tmpdir(), 'human-agency-production-'));
	context.after(() => rm(contentDirectory, { recursive: true, force: true }));
	const publishPackage = await readHumanAgencyPackage(
		resolve(fixtures, 'valid', 'exchange-package.publish.v1.json'),
		new Set(['approved-publish']),
	);
	const stored = { published_at: publishPackage.generated_at, entry: publishPackage.entries[0] };
	await writeFile(join(contentDirectory, 'entry.json'), `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
	assert.equal((await loadHumanAgencyEntries({ contentDirectory })).length, 1);
	const tampered = structuredClone(stored);
	tampered.entry!.title = 'tampered';
	await writeFile(join(contentDirectory, 'entry.json'), `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
	await assert.rejects(loadHumanAgencyEntries({ contentDirectory }), /Entry hash mismatch/);
});

test('package verifier catches a top-level content hash change', async () => {
	const value = JSON.parse(
		await readFile(resolve(fixtures, 'valid', 'exchange-package.v1.json'), 'utf8'),
	) as Record<string, unknown>;
	value.package_id = 'changed-without-new-hash';
	await assert.rejects(verifyHumanAgencyPackage(value), /content hash mismatch/);
});
