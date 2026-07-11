import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_PATTERN = /^src\/content\/blog\/.+\.mdx?$/i;
const ASSET_PATTERN = /^public\/image\/blog\//i;

export function normalizeReleasePath(filePath) {
	return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function classifyContentReleasePaths(filePaths) {
	const paths = [...new Set(filePaths.map(normalizeReleasePath).filter(Boolean))].sort();
	const contentFiles = paths.filter((filePath) => CONTENT_PATTERN.test(filePath));
	const assetFiles = paths.filter((filePath) => ASSET_PATTERN.test(filePath));
	const rejectedPaths = paths.filter(
		(filePath) => !CONTENT_PATTERN.test(filePath) && !ASSET_PATTERN.test(filePath),
	);

	return {
		paths,
		contentFiles,
		assetFiles,
		rejectedPaths,
		eligible: paths.length > 0 && contentFiles.length > 0 && rejectedPaths.length === 0,
	};
}

export function getContentReleaseRoutes(contentFiles, projectRoot = process.cwd()) {
	const routes = new Set([
		'/',
		'/blog/',
		'/tags/',
		'/rss.xml',
		'/rss-en.xml',
		'/rss-zh.xml',
		'/feed.xml',
		'/feed-en.xml',
		'/feed-zh.xml',
		'/sitemap.xml',
	]);
	for (const filePath of contentFiles.map(normalizeReleasePath)) {
		const source = readFileSync(path.resolve(projectRoot, filePath), 'utf8');
		const frontmatter = source.startsWith('---') ? source.split('---', 3)[1] ?? '' : '';
		if (/^draft:\s*true\s*$/im.test(frontmatter)) continue;

		const articleId = path.basename(filePath).replace(/\.mdx?$/i, '');
		routes.add(`/blog/${articleId}/`);
		for (const tag of readInlineList(frontmatter, 'tags')) {
			routes.add(`/tags/${tag.trim().toLowerCase()}/`);
		}
	}
	return [...routes];
}

function readInlineList(frontmatter, field) {
	const match = frontmatter.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]`, 'im'));
	if (!match) return [];
	return match[1]
		.split(',')
		.map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
		.filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const filePaths = JSON.parse(process.env.CONTENT_RELEASE_PATHS_JSON || '[]');
	const classification = classifyContentReleasePaths(filePaths);
	const routes = classification.eligible
		? getContentReleaseRoutes(classification.contentFiles)
		: [];
	process.stdout.write(JSON.stringify({ ...classification, routes }));
}
