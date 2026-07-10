import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

const MAX_PUBLIC_ASSET_BYTES = 1024 * 1024;
const MAX_PUBLIC_RASTER_PIXELS = 5_000_000;
const RASTER_EXTENSION = /\.(?:avif|gif|jpe?g|png|tiff?|webp)$/i;

async function listFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(entries.map(async (entry) => {
		const absolutePath = path.join(directory, entry.name);
		return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
	}));
	return files.flat();
}

test('individual public assets stay below the one-megabyte maintenance budget', async () => {
	const publicRoot = path.resolve('public');
	const oversized: string[] = [];
	for (const file of await listFiles(publicRoot)) {
		const fileStat = await stat(file);
		if (fileStat.size > MAX_PUBLIC_ASSET_BYTES) {
			oversized.push(`${path.relative(publicRoot, file)} (${fileStat.size} bytes)`);
		}
	}

	assert.deepEqual(oversized, [], `oversized public assets:\n${oversized.join('\n')}`);
});

test('directly served public raster images stay within the decode budget', async () => {
	const publicRoot = path.resolve('public');
	const oversized: string[] = [];
	for (const file of (await listFiles(publicRoot)).filter((entry) => RASTER_EXTENSION.test(entry))) {
		const metadata = await sharp(file).metadata();
		const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
		if (pixels > MAX_PUBLIC_RASTER_PIXELS) {
			oversized.push(`${path.relative(publicRoot, file)} (${metadata.width}x${metadata.height})`);
		}
	}

	assert.deepEqual(oversized, [], `public raster decode budget exceeded:\n${oversized.join('\n')}`);
});
