import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertAllowedContentPath,
	buildReleaseId,
	deriveArticleRoutes,
	parseArticleFrontmatter,
	validateArticleSource,
} from '../scripts/site-release.mjs';

const validArticle = `---
title: "测试文章"
description: "一篇用于验证的文章。"
pubDate: 2026-07-19
lang: "cn"
group: "demo"
tags: ["Demo"]
category: "Blog"
---

## 正文
`;

test('site release accepts only articles and dedicated article assets', () => {
	assert.equal(assertAllowedContentPath('src/content/blog/demo-cn.md'), 'src/content/blog/demo-cn.md');
	assert.equal(assertAllowedContentPath('public/image/blog/demo/hero.webp'), 'public/image/blog/demo/hero.webp');
	assert.equal(assertAllowedContentPath('public/file/blog/demo/data.pdf'), 'public/file/blog/demo/data.pdf');

	for (const rejected of [
		'src/content/blog/demo-cn.mdx',
		'src/content/blog/nested/demo-cn.md',
		'src/components/Header.astro',
		'server/src/app.js',
		'../secrets',
		'src/content/blog/../../etc/passwd',
		'public/image/blog/demo/hero.svg',
	]) {
		assert.throws(() => assertAllowedContentPath(rejected), /not an article/u, rejected);
	}
});

test('site release validates required frontmatter fields', () => {
	const fields = validateArticleSource(validArticle, 'src/content/blog/demo-cn.md');
	assert.equal(fields.title, '测试文章');
	assert.equal(fields.lang, 'cn');

	assert.throws(() => validateArticleSource('---\ndescription: "x"\npubDate: 2026-07-19\n---\n', 'a.md'), /missing title/u);
	assert.throws(() => validateArticleSource('---\ntitle: "x"\npubDate: 2026-07-19\n---\n', 'a.md'), /missing description/u);
	assert.throws(() => validateArticleSource('---\ntitle: "x"\ndescription: "y"\npubDate: not-a-date\n---\n', 'a.md'), /invalid pubDate/u);
	assert.throws(() => validateArticleSource('---\ntitle: "x"\ndescription: "y"\npubDate: 2026-07-19\nlang: "fr"\n---\n', 'a.md'), /invalid lang/u);
});

test('site release parses frontmatter with quoted values and CRLF', () => {
	const fields = parseArticleFrontmatter(validArticle.replaceAll('\n', '\r\n'));
	assert.equal(fields.group, 'demo');
	assert.equal(fields.title, '测试文章');
	assert.deepEqual(parseArticleFrontmatter('# no frontmatter\n'), {});
});

test('site release derives public routes and skips drafts', () => {
	const routes = deriveArticleRoutes([
		{ repoPath: 'src/content/blog/demo-cn.md', source: validArticle },
		{ repoPath: 'src/content/blog/hidden-cn.md', source: validArticle.replace('group: "demo"', 'draft: true') },
		{ repoPath: 'public/image/blog/demo/hero.webp', source: 'binary' },
	]);

	assert.ok(routes.includes('/blog/demo-cn/'));
	assert.ok(!routes.includes('/blog/hidden-cn/'));
	assert.ok(routes.includes('/'));
	assert.ok(routes.includes('/feed.xml'));
	assert.ok(routes.includes('/sitemap.xml'));
});

test('site release ids stay unique, sortable, and release-id safe', () => {
	const id = buildReleaseId(new Date('2026-07-19T10:22:06.735Z'), 'abc1234');
	assert.match(id, /^20260719T102206Z-web-abc1234$/);
	assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
});
