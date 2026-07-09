/*
 * One-shot brand asset generator.
 * Builds a neutral temporary favicon set for the site. The icon is intentionally
 * generic so it can be replaced later without changing head metadata.
 *
 *   node scripts/generate-brand-assets.mjs
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const iconSvg = (size = 512) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" data-generic-site-icon="xgwnje">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#18181b"/>
  <rect x="${size * 0.08}" y="${size * 0.08}" width="${size * 0.84}" height="${size * 0.84}" rx="${size * 0.18}" fill="#ffffff" opacity="0.06"/>
  <rect x="${size * 0.08}" y="${size * 0.08}" width="${size * 0.84}" height="${size * 0.84}" rx="${size * 0.18}" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="${size * 0.025}"/>
  <path d="M ${size * 0.32} ${size * 0.30} L ${size * 0.68} ${size * 0.70} M ${size * 0.68} ${size * 0.30} L ${size * 0.32} ${size * 0.70}" fill="none" stroke="#f8fafc" stroke-width="${size * 0.105}" stroke-linecap="round"/>
  <path d="M ${size * 0.31} ${size * 0.76} H ${size * 0.69}" fill="none" stroke="#d6b35f" stroke-width="${size * 0.045}" stroke-linecap="round"/>
</svg>`;

const renderPng = async (size) =>
	sharp(Buffer.from(iconSvg(size)))
		.resize(size, size, { fit: 'contain' })
		.png()
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
	const [png16, png32, png48, png180, png192, png512] = await Promise.all(
		[16, 32, 48, 180, 192, 512].map(renderPng)
	);

	const ico = buildIco([
		{ size: 16, buf: png16 },
		{ size: 32, buf: png32 },
		{ size: 48, buf: png48 },
	]);

	await Promise.all([
		writeFile(path.join(publicDir, 'favicon.ico'), ico),
		writeFile(path.join(publicDir, 'image', 'favicon.ico'), ico),
		writeFile(path.join(publicDir, 'favicon.svg'), iconSvg(64)),
		writeFile(path.join(publicDir, 'image', 'favicon-32.png'), png32),
		writeFile(path.join(publicDir, 'image', 'favicon-192.png'), png192),
		writeFile(path.join(publicDir, 'image', 'favicon-512.png'), png512),
		writeFile(path.join(publicDir, 'image', 'apple-touch-icon.png'), png180),
	]);

	console.log('Generic favicon set generated');
};

await main();
