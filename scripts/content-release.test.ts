import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as contentReleaseScope from './content-release-scope.mjs';
import {
	classifyContentReleasePaths,
	findPublishedArticlesTurnedDraft,
	getContentReleaseRoutes,
} from './content-release-scope.mjs';

test('content release scope accepts posts and dedicated blog assets only', () => {
	const result = classifyContentReleasePaths([
		'src\\content\\blog\\release-cn.md',
		'src/content/blog/release-en.md',
		'public/image/blog/release/hero.webp',
	]);

	assert.equal(result.eligible, true);
	assert.deepEqual(result.rejectedPaths, []);
	assert.equal(result.contentFiles.length, 2);
});

test('content release selection ignores unrelated repository changes', () => {
	assert.equal(typeof contentReleaseScope.selectContentReleasePaths, 'function');
	const result = contentReleaseScope.selectContentReleasePaths([
		'src/content/blog/release-cn.md',
		'public/image/blog/release/hero.webp',
		'src/components/Header.astro',
		'server/src/app.js',
	]);

	assert.equal(result.eligible, true);
	assert.deepEqual(result.paths, [
		'public/image/blog/release/hero.webp',
		'src/content/blog/release-cn.md',
	]);
	assert.deepEqual(result.ignoredPaths, [
		'server/src/app.js',
		'src/components/Header.astro',
	]);
});

test('content release accepts safe files from an article attachment directory', () => {
	const result = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'public/file/blog/release/evidence.pdf',
		'public/file/blog/release/data.csv',
	]);

	assert.equal(result.eligible, true);
	assert.deepEqual(result.attachmentFiles, [
		'public/file/blog/release/data.csv',
		'public/file/blog/release/evidence.pdf',
	]);
});

test('content release accepts native Markdown but rejects raw HTML', async () => {
	assert.equal(typeof contentReleaseScope.findArticlesUsingRawHtml, 'function');
	const root = await mkdtemp(path.join(os.tmpdir(), 'homepage-content-markdown-'));
	const blog = path.join(root, 'src', 'content', 'blog');
	await mkdir(blog, { recursive: true });
	await writeFile(
		path.join(blog, 'native-cn.md'),
		'# Title\n\n![Image](/image/blog/native/hero.webp)\n\n[Link](https://example.com)\n\n```html\n<div>example</div>\n```\n',
		'utf8',
	);
	await writeFile(path.join(blog, 'html-cn.md'), '# Title\n\n<details>hidden</details>\n', 'utf8');

	const invalid = contentReleaseScope.findArticlesUsingRawHtml([
		'src/content/blog/native-cn.md',
		'src/content/blog/html-cn.md',
	], root);
	assert.deepEqual(invalid, ['src/content/blog/html-cn.md']);
	await rm(root, { recursive: true, force: true });
});

test('content release reports missing local article images and attachments', async (context) => {
	let linkModule: typeof import('./content-release-links.mjs') | undefined;
	try {
		linkModule = await import('./content-release-links.mjs');
	} catch {
		// The RED phase intentionally reaches this branch before the checker exists.
	}
	assert.equal(typeof linkModule?.findMissingLocalReleaseTargets, 'function');

	const distRoot = await mkdtemp(path.join(os.tmpdir(), 'homepage-content-links-'));
	context.after(() => rm(distRoot, { recursive: true, force: true }));
	await mkdir(path.join(distRoot, 'blog', 'release-cn'), { recursive: true });
	await mkdir(path.join(distRoot, 'image', 'blog', 'release'), { recursive: true });
	await writeFile(path.join(distRoot, 'image', 'blog', 'release', 'hero.webp'), 'image', 'utf8');
	await writeFile(
		path.join(distRoot, 'blog', 'release-cn', 'index.html'),
		'<img src="/image/blog/release/hero.webp"><a href="/file/blog/release/evidence.pdf">PDF</a><a href="https://example.com">External</a>',
		'utf8',
	);

	const missing = await linkModule!.findMissingLocalReleaseTargets({
		distRoot,
		routes: ['/blog/release-cn/'],
	});
	assert.deepEqual(missing, [
		{ route: '/blog/release-cn/', target: '/file/blog/release/evidence.pdf' },
	]);
});

test('fast content release rejects MDX because components require frontend verification', () => {
	const result = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'src/content/blog/release-en.mdx',
	]);

	assert.equal(result.eligible, false);
	assert.deepEqual(result.rejectedPaths, ['src/content/blog/release-en.mdx']);
});

test('fast content release rejects nested posts to keep route handling predictable', () => {
	const result = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'src/content/blog/category/release-en.md',
	]);

	assert.equal(result.eligible, false);
	assert.deepEqual(result.rejectedPaths, ['src/content/blog/category/release-en.md']);
});

test('fast content release accepts only supported web image formats', () => {
	const accepted = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'public/image/blog/release/cover.avif',
		'public/image/blog/release/animation.gif',
		'public/image/blog/release/photo.jpeg',
		'public/image/blog/release/photo.jpg',
		'public/image/blog/release/diagram.png',
		'public/image/blog/release/hero.webp',
	]);
	const rejected = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'public/image/blog/release/source.svg',
		'public/image/blog/release/archive.tiff',
		'public/image/blog/release/metadata.json',
	]);

	assert.equal(accepted.eligible, true);
	assert.equal(accepted.assetFiles.length, 6);
	assert.equal(rejected.eligible, false);
	assert.deepEqual(rejected.rejectedPaths, [
		'public/image/blog/release/archive.tiff',
		'public/image/blog/release/metadata.json',
		'public/image/blog/release/source.svg',
	]);
});

test('published articles cannot be hidden by changing frontmatter to draft', () => {
	const changed = findPublishedArticlesTurnedDraft([
		{
			path: 'src/content/blog/published-cn.md',
			previousSource: '---\ndraft: false\n---\n',
			currentSource: '---\ndraft: true # intentionally hidden\n---\n',
		},
		{
			path: 'src/content/blog/already-draft-cn.md',
			previousSource: '---\ndraft: true\n---\n',
			currentSource: '---\ndraft: true\n---\n',
		},
	]);

	assert.deepEqual(changed, ['src/content/blog/published-cn.md']);
});

test('content release scope rejects frontend, deployment, and server changes', () => {
	const result = classifyContentReleasePaths([
		'src/content/blog/release-cn.md',
		'src/components/Header.astro',
		'server/src/app.js',
		'.agents/skills/deploy-homepage/SKILL.md',
	]);

	assert.equal(result.eligible, false);
	assert.deepEqual(result.rejectedPaths, [
		'.agents/skills/deploy-homepage/SKILL.md',
		'server/src/app.js',
		'src/components/Header.astro',
	]);
});

test('content release routes cover published articles, tags, feeds, and indexes', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'homepage-content-release-'));
	const blog = path.join(root, 'src', 'content', 'blog');
	await mkdir(blog, { recursive: true });
	await writeFile(
		path.join(blog, 'release-cn.md'),
		'---\ntitle: Release\ntags: ["Engineering", "Human AI"]\ndraft: false\n---\n',
		'utf8',
	);
	await writeFile(
		path.join(blog, 'draft-en.md'),
		'---\ntitle: Draft\ntags: ["Hidden"]\ndraft: true\n---\n',
		'utf8',
	);

	const routes = getContentReleaseRoutes([
		'src/content/blog/release-cn.md',
		'src/content/blog/draft-en.md',
	], root);

	assert(routes.includes('/'));
	assert(routes.includes('/blog/'));
	assert(routes.includes('/tags/engineering/'));
	assert(routes.includes('/tags/human%20ai/'));
	assert(routes.includes('/rss-en.xml'));
	assert(routes.includes('/feed-zh.xml'));
	assert(routes.includes('/sitemap.xml'));
	assert(routes.includes('/blog/release-cn/'));
	assert(!routes.includes('/blog/draft-en/'));
	assert(!routes.includes('/tags/hidden/'));
});
