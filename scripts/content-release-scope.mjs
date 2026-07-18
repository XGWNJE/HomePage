import { parseFrontmatter } from '@astrojs/markdown-remark';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_PATTERN = /^src\/content\/blog\/[^/]+\.md$/i;
const ASSET_PATTERN = /^public\/image\/blog\/.+\.(?:avif|gif|jpe?g|png|webp)$/i;

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
		const frontmatter = parseFrontmatter(source).frontmatter;
		if (frontmatter.draft === true) continue;

		const articleId = path.basename(filePath).replace(/\.mdx?$/i, '');
		routes.add(`/blog/${articleId}/`);
		for (const tag of Array.isArray(frontmatter.tags) ? frontmatter.tags : []) {
			if (typeof tag === 'string' && tag.trim()) {
				routes.add(`/tags/${encodeURIComponent(tag.trim().toLowerCase())}/`);
			}
		}
	}
	return [...routes];
}

export function findPublishedArticlesTurnedDraft(entries) {
	return entries
		.filter(({ previousSource, currentSource }) => (
			parseFrontmatter(previousSource).frontmatter.draft !== true &&
			parseFrontmatter(currentSource).frontmatter.draft === true
		))
		.map(({ path: filePath }) => filePath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const filePaths = JSON.parse(process.env.CONTENT_RELEASE_PATHS_JSON || '[]');
	const classification = classifyContentReleasePaths(filePaths);
	const routes = classification.eligible
		? getContentReleaseRoutes(classification.contentFiles)
		: [];
	const revision = process.env.CONTENT_RELEASE_PRODUCTION_REVISION;
	const comparisons = [];
	if (classification.eligible && revision) {
		for (const filePath of classification.contentFiles) {
			const previous = spawnSync('git', ['show', `${revision}:${filePath}`], {
				cwd: process.cwd(),
				encoding: 'utf8',
			});
			if (previous.error) throw previous.error;
			if (previous.status !== 0) continue;
			comparisons.push({
				path: filePath,
				previousSource: previous.stdout,
				currentSource: readFileSync(path.resolve(filePath), 'utf8'),
			});
		}
	}
	process.stdout.write(JSON.stringify({
		...classification,
		routes,
		publishedToDraft: findPublishedArticlesTurnedDraft(comparisons),
	}));
}
