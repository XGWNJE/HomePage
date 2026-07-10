import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const failures = [];
const assert = (condition, message) => {
	if (!condition) failures.push(message);
};

const readText = (path) => readFileSync(path, 'utf8');

const head = readText('src/components/BaseHead.astro');
const constants = readText('src/consts.ts');
const generator = readText('scripts/generate-brand-assets.mjs');
const faviconSvg = readText('public/favicon.svg');

assert(!head.includes('original avatar'), 'BaseHead should not describe the favicon set as avatar-derived.');
assert(!generator.includes('circle-cropped'), 'Brand generator should not describe avatar circle cropping.');
assert(!generator.includes('const SOURCE'), 'Brand generator should not depend on the old avatar source image.');
assert(!faviconSvg.includes('<image'), 'SVG favicon should be vector, not a PNG-embedded avatar.');
assert(faviconSvg.includes('data-generic-site-icon'), 'SVG favicon should be the generic site icon.');
assert(head.includes('XGWNJE — Research · Engineering · Notes'), 'Default OG alt text should match the current positioning.');
assert(constants.includes("SITE_DESCRIPTION = 'Research · Engineering · Notes'"), 'Shared site description should match the current positioning.');

const ogMeta = await sharp('public/image/og-default.png').metadata();
assert(ogMeta.width === 1200 && ogMeta.height === 630, 'Default OG image should be 1200x630.');
assert(readFileSync('public/image/og-default.png').length < 1024 * 1024, 'Default OG image should stay below 1 MB.');

const expectedPngs = [
	['public/image/favicon-32.png', 32],
	['public/image/apple-touch-icon.png', 180],
	['public/image/favicon-192.png', 192],
	['public/image/favicon-512.png', 512],
];

for (const [path, size] of expectedPngs) {
	const meta = await sharp(path).metadata();
	assert(meta.width === size && meta.height === size, `${path} should be ${size}x${size}.`);
}

const icoRoot = readFileSync('public/favicon.ico');
const icoImage = readFileSync('public/image/favicon.ico');
assert(icoRoot.equals(icoImage), 'Root and image favicon.ico should stay in sync.');
assert(icoRoot.readUInt16LE(0) === 0 && icoRoot.readUInt16LE(2) === 1, 'favicon.ico should be an ICO file.');

if (failures.length) {
	console.error('[brand-assets] failed');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log('[brand-assets] ok');
