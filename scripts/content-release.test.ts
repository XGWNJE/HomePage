import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
