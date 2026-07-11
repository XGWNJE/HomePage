import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	classifyContentReleasePaths,
	getContentReleaseRoutes,
} from './content-release-scope.mjs';

test('content release scope accepts posts and dedicated blog assets only', () => {
	const result = classifyContentReleasePaths([
		'src\\content\\blog\\release-cn.md',
		'src/content/blog/release-en.mdx',
		'public/image/blog/release/hero.webp',
	]);

	assert.equal(result.eligible, true);
	assert.deepEqual(result.rejectedPaths, []);
	assert.equal(result.contentFiles.length, 2);
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
		'---\ntitle: Release\ntags: ["Engineering", "Notes"]\ndraft: false\n---\n',
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
	assert(routes.includes('/tags/notes/'));
	assert(routes.includes('/rss-en.xml'));
	assert(routes.includes('/feed-zh.xml'));
	assert(routes.includes('/sitemap.xml'));
	assert(routes.includes('/blog/release-cn/'));
	assert(!routes.includes('/blog/draft-en/'));
	assert(!routes.includes('/tags/hidden/'));
});
