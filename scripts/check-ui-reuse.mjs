import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const toPosix = value => value.split(path.sep).join('/');

const walk = directory =>
	readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const entryPath = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(entryPath) : [entryPath];
	});

const manifestPath = 'src/data/visualAssets.ts';
const manifest = readFileSync(manifestPath, 'utf8');
const localAssetPaths = [...manifest.matchAll(/'(?<asset>\/image\/[^']+)'/g)].map(match => match.groups.asset);

assert(localAssetPaths.length > 0, 'visualAssets.ts should register local visual assets.');
for (const assetPath of localAssetPaths) {
	const publicPath = path.join('public', assetPath.replace(/^\//, ''));
	assert(existsSync(publicPath), `Registered visual asset is missing: ${publicPath}`);
}

const sourceFiles = walk('src').filter(file => /\.(?:astro|ts|tsx|js|mjs)$/.test(file));
for (const file of sourceFiles) {
	if (toPosix(file) === manifestPath) continue;
	const source = readFileSync(file, 'utf8');
	assert.doesNotMatch(
		source,
		/["'`]\/image\/(?:sandrone|mascot)\//,
		`${toPosix(file)} should use visualAssets.ts instead of a raw character asset path.`,
	);
	assert.doesNotMatch(
		source,
		/桑多涅参考资料/,
		`${toPosix(file)} must not reference research-only Sandrone source material.`,
	);
}

const allowedInlineSvgFiles = new Set([
	'src/components/Comment.astro',
	'src/components/ContactModal.astro',
	'src/components/Footer.astro',
	'src/components/GoldenSpiral.astro',
	'src/components/Header.astro',
	'src/components/LoginModal.astro',
	'src/components/MobileDrawer.astro',
	'src/components/ParthenonColumns.astro',
	'src/components/PostCard.astro',
	'src/components/SettingsModal.astro',
	'src/components/TocDrawer.astro',
	'src/layouts/BlogPost.astro',
	'src/pages/blog/archive.astro',
	'src/pages/blog/important.astro',
	'src/pages/blog/index.astro',
	'src/pages/blog/page/[...page].astro',
	'src/pages/index.astro',
	'src/pages/links/index.astro',
]);

for (const file of sourceFiles.filter(file => file.endsWith('.astro'))) {
	const normalized = toPosix(file);
	if (!readFileSync(file, 'utf8').includes('<svg')) continue;
	assert(
		allowedInlineSvgFiles.has(normalized),
		`${normalized} adds inline SVG outside the current legacy allowlist; reuse the icon system or a named decoration component.`,
	);
}

console.log(`UI reuse contract verified (${localAssetPaths.length} visual assets registered).`);
