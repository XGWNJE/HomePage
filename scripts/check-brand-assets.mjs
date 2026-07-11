import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const failures = [];
const assert = (condition, message) => {
	if (!condition) failures.push(message);
};

const readText = (path) => readFileSync(path, 'utf8');

const head = readText('src/components/BaseHead.astro');
const constants = readText('src/consts.ts');
const generator = readText('scripts/generate-brand-assets.mjs');

assert(head.includes('image/favicon.ico'), 'BaseHead should reference the generated ICO favicon.');
assert(head.includes('image/favicon-32.png'), 'BaseHead should reference the generated 32px PNG favicon.');
assert(!head.includes('favicon.svg'), 'BaseHead should not prefer the retired generic SVG favicon.');
assert(!existsSync('public/favicon.svg'), 'The retired generic SVG favicon should be removed.');
assert(existsSync('src/assets/site-icon-source.png'), 'The committed site icon source should exist.');
assert(generator.includes("'site-icon-source.png'"), 'Brand generator should use the committed site icon source.');
assert(head.includes('XGWNJE — Research · Engineering · Notes'), 'Default OG alt text should match the current positioning.');
assert(constants.includes("SITE_DESCRIPTION = 'Research · Engineering · Notes'"), 'Shared site description should match the current positioning.');

const sourceMeta = await sharp('src/assets/site-icon-source.png').metadata();
assert(sourceMeta.width === sourceMeta.height && sourceMeta.width >= 512, 'Site icon source should be square and at least 512px.');

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
