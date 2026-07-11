/*
 * One-shot site icon generator.
 * Builds the browser, Apple Touch, and fallback avatar icon set from the
 * committed square source image.
 *
 *   node scripts/generate-brand-assets.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const sourcePath = path.join(root, 'src', 'assets', 'site-icon-source.png');

const renderPng = async (source, size) =>
	sharp(source)
		.resize(size, size, { fit: 'cover', position: 'centre' })
		.png({ compressionLevel: 9, palette: size <= 48 })
		.toBuffer();

// ICO container with PNG-compressed entries (supported since Windows Vista / all browsers).
const buildIco = (entries) => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);

	const dirs = [];
	const blobs = [];
	let offset = 6 + 16 * entries.length;
	for (const { size, buf } of entries) {
		const dir = Buffer.alloc(16);
		dir.writeUInt8(size >= 256 ? 0 : size, 0);
		dir.writeUInt8(size >= 256 ? 0 : size, 1);
		dir.writeUInt8(0, 2);
		dir.writeUInt8(0, 3);
		dir.writeUInt16LE(1, 4);
		dir.writeUInt16LE(32, 6);
		dir.writeUInt32LE(buf.length, 8);
		dir.writeUInt32LE(offset, 12);
		dirs.push(dir);
		blobs.push(buf);
		offset += buf.length;
	}
	return Buffer.concat([header, ...dirs, ...blobs]);
};

const main = async () => {
	const source = await readFile(sourcePath);
	const [png16, png32, png48, png180, png192, png512] = await Promise.all(
		[16, 32, 48, 180, 192, 512].map((size) => renderPng(source, size))
	);

	const ico = buildIco([
		{ size: 16, buf: png16 },
		{ size: 32, buf: png32 },
		{ size: 48, buf: png48 },
	]);

	await Promise.all([
		writeFile(path.join(publicDir, 'favicon.ico'), ico),
		writeFile(path.join(publicDir, 'image', 'favicon.ico'), ico),
		writeFile(path.join(publicDir, 'image', 'favicon-32.png'), png32),
		writeFile(path.join(publicDir, 'image', 'favicon-192.png'), png192),
		writeFile(path.join(publicDir, 'image', 'favicon-512.png'), png512),
		writeFile(path.join(publicDir, 'image', 'apple-touch-icon.png'), png180),
	]);

	console.log('Site icon set generated from src/assets/site-icon-source.png');
};

await main();
