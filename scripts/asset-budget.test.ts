import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp, { type Metadata } from 'sharp';

const MAX_PUBLIC_ASSET_BYTES = 1024 * 1024;
const MAX_PUBLIC_RASTER_PIXELS = 5_000_000;
const RASTER_EXTENSION = /\.(?:avif|gif|jpe?g|png|tiff?|webp)$/i;

export function getDecodedPixelCount(
	metadata: Pick<Metadata, 'width' | 'height' | 'pageHeight' | 'pages'>,
): number {
	const frames = metadata.pages ?? 1;
	const totalHeight = metadata.pageHeight && frames > 1
		? metadata.pageHeight * frames
		: (metadata.height ?? 0);
	return (metadata.width ?? 0) * totalHeight;
}

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
		const metadata = await sharp(file, { animated: true }).metadata();
		const pixels = getDecodedPixelCount(metadata);
		if (pixels > MAX_PUBLIC_RASTER_PIXELS) {
			oversized.push(`${path.relative(publicRoot, file)} (${pixels} decoded pixels)`);
		}
	}

	assert.deepEqual(oversized, [], `public raster decode budget exceeded:\n${oversized.join('\n')}`);
});

test('animated raster budgets include every decoded frame', () => {
	assert.equal(getDecodedPixelCount({ width: 200, height: 100, pageHeight: 100, pages: 8 }), 160_000);
});
