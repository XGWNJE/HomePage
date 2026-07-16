import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	assertSafeRelativePath,
	collectTreeManifest,
	diffTreeManifests,
	parseTreeTsv,
} from './content-delta.mjs';

async function write(root: string, relative: string, contents: string) {
	const target = path.join(root, ...relative.split('/'));
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents, 'utf8');
}

test('content delta keeps unchanged files and isolates additions, changes, and deletions', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'homepage-delta-'));
	const previousRoot = path.join(root, 'previous');
	const currentRoot = path.join(root, 'current');
	await write(previousRoot, 'index.html', 'old home');
	await write(previousRoot, 'assets/site.css', 'stable');
	await write(previousRoot, 'blog/old/index.html', 'old post');
	await write(currentRoot, 'index.html', 'new home');
	await write(currentRoot, 'assets/site.css', 'stable');
	await write(currentRoot, 'blog/new/index.html', 'new post');

	const previous = await collectTreeManifest(previousRoot);
	const current = await collectTreeManifest(currentRoot);
	const delta = diffTreeManifests(previous, current);

	assert.deepEqual(delta.changedPaths, ['blog/new/index.html', 'index.html']);
	assert.deepEqual(delta.deletedPaths, ['blog/old/index.html']);
	assert.equal(current.fileCount, 3);
	assert.equal(current.totalBytes, 22);
	assert.match(current.treeSha256, /^[a-f0-9]{64}$/);
});

test('tree TSV parsing is deterministic and rejects paths that escape the release root', () => {
	const manifest = parseTreeTsv(
		`${'b'.repeat(64)}\t3\tz-last.txt\n${'a'.repeat(64)}\t2\ta-first.txt\n`,
	);
	assert.deepEqual(manifest.files.map((file: { path: string }) => file.path), ['a-first.txt', 'z-last.txt']);
	assert.throws(() => parseTreeTsv(`${'a'.repeat(64)}\t2\t../escape.txt\n`), /Unsafe release path/);
	assert.throws(() => assertSafeRelativePath('/absolute.txt'), /Unsafe release path/);
	assert.throws(() => assertSafeRelativePath('-C'), /Unsafe release path/);
});
