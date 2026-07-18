import { parseFrontmatter } from '@astrojs/markdown-remark';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_PATTERN = /^src\/content\/blog\/[^/]+\.md$/i;
const IMAGE_PATTERN = /^public\/image\/blog\/.+\.(?:avif|gif|jpe?g|png|webp)$/i;
const ATTACHMENT_PATTERN = /^public\/file\/blog\/.+\.(?:csv|json|mp3|mp4|ogg|pdf|txt|wav|webm|zip)$/i;

export function normalizeReleasePath(filePath) {
	return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isContentReleasePath(filePath) {
	const normalized = normalizeReleasePath(filePath);
	return CONTENT_PATTERN.test(normalized) || IMAGE_PATTERN.test(normalized) || ATTACHMENT_PATTERN.test(normalized);
}

export function classifyContentReleasePaths(filePaths) {
	const paths = [...new Set(filePaths.map(normalizeReleasePath).filter(Boolean))].sort();
	const contentFiles = paths.filter((filePath) => CONTENT_PATTERN.test(filePath));
	const imageFiles = paths.filter((filePath) => IMAGE_PATTERN.test(filePath));
	const attachmentFiles = paths.filter((filePath) => ATTACHMENT_PATTERN.test(filePath));
	const assetFiles = [...imageFiles, ...attachmentFiles].sort();
	const rejectedPaths = paths.filter((filePath) => !isContentReleasePath(filePath));

	return {
		paths,
		contentFiles,
		imageFiles,
		attachmentFiles,
		assetFiles,
		rejectedPaths,
		eligible: paths.length > 0 && contentFiles.length > 0 && rejectedPaths.length === 0,
	};
}

export function selectContentReleasePaths(filePaths) {
	const repositoryPaths = [...new Set(filePaths.map(normalizeReleasePath).filter(Boolean))].sort();
	const selectedPaths = repositoryPaths.filter(isContentReleasePath);
	const ignoredPaths = repositoryPaths.filter((filePath) => !isContentReleasePath(filePath));

	return {
		...classifyContentReleasePaths(selectedPaths),
		ignoredPaths,
	};
}

function sourceUsesRawHtml(source) {
	const lines = source.replaceAll('\r\n', '\n').split('\n');
	let inFrontmatter = lines[0]?.trim() === '---';
	let fence;
	for (let index = inFrontmatter ? 1 : 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (inFrontmatter) {
			if (line.trim() === '---') inFrontmatter = false;
			continue;
		}
		const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/u);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (!fence) {
				fence = marker;
				continue;
			}
			if (marker[0] === fence[0] && marker.length >= fence.length) {
				fence = undefined;
			}
			continue;
		}
		if (fence || /^(?: {4}|\t)/u.test(line)) continue;
		const withoutInlineCode = line.replace(/(`+)[^`]*?\1/gu, '');
		if (/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\s*\/?>/u.test(withoutInlineCode)) return true;
	}
	return false;
}

export function findArticlesUsingRawHtml(contentFiles, projectRoot = process.cwd()) {
	return contentFiles
		.map(normalizeReleasePath)
		.filter((filePath) => sourceUsesRawHtml(readFileSync(path.resolve(projectRoot, filePath), 'utf8')))
		.sort();
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
	const classification = process.env.CONTENT_RELEASE_SELECT_ONLY === '1'
		? selectContentReleasePaths(filePaths)
		: classifyContentReleasePaths(filePaths);
	const projectRoot = process.env.CONTENT_RELEASE_PROJECT_ROOT || process.cwd();
	const routes = classification.eligible
		? getContentReleaseRoutes(classification.contentFiles, projectRoot)
		: [];
	const rawHtmlArticles = classification.eligible
		? findArticlesUsingRawHtml(classification.contentFiles, projectRoot)
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
				currentSource: readFileSync(path.resolve(projectRoot, filePath), 'utf8'),
			});
		}
	}
	process.stdout.write(JSON.stringify({
		...classification,
		routes,
		rawHtmlArticles,
		publishedToDraft: findPublishedArticlesTurnedDraft(comparisons),
	}));
}
