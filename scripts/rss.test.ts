import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { CollectionEntry } from 'astro:content';

import { generateRssFeed } from '../src/utils/rss.ts';

const asBlogPost = (post: unknown) => post as CollectionEntry<'blog'>;
const basePost = {
	id: 'mdx-content-cn',
	body: '<DemoComponent /> should not leak into RSS',
	data: {
		title: 'MDX content',
		description: 'Summary only',
		pubDate: new Date('2026-07-17T00:00:00Z'),
		lang: 'cn' as const,
	},
};

test('RSS omits raw MDX source when rendered HTML is unavailable', async () => {
	const response = await generateRssFeed({
		posts: [asBlogPost(basePost)],
		title: '中文订阅',
		description: '中文文章',
		site: 'https://xgwnje.cn',
		language: 'zh-CN',
	});
	const xml = await response.text();

	assert.match(xml, /<language>zh-CN<\/language>/);
	assert.match(xml, /<description>Summary only<\/description>/);
	assert.doesNotMatch(xml, /DemoComponent|content:encoded/);
});

test('RSS includes rendered HTML and the English channel language', async () => {
	const response = await generateRssFeed({
		posts: [asBlogPost({ ...basePost, rendered: { html: '<p>Rendered article</p>' } })],
		title: 'English feed',
		description: 'English posts',
		site: 'https://xgwnje.cn',
		language: 'en',
	});
	const xml = await response.text();

	assert.match(xml, /<language>en<\/language>/);
	assert.match(xml, /<content:encoded>&lt;p&gt;Rendered article&lt;\/p&gt;<\/content:encoded>/);
});

test('mixed-language RSS does not declare a channel language', async () => {
	const response = await generateRssFeed({
		posts: [asBlogPost(basePost)],
		title: 'Mixed feed',
		description: 'All posts',
		site: 'https://xgwnje.cn',
	});
	const xml = await response.text();

	assert.doesNotMatch(xml, /<language>/);
});

test('language-specific endpoints declare only their channel language', async () => {
	const read = (file: string) => readFile(path.resolve('src/pages', file), 'utf8');
	const [feedZh, feedEn, feedMixed] = await Promise.all([
		read('feed-zh.xml.ts'),
		read('feed-en.xml.ts'),
		read('feed.xml.ts'),
	]);

	assert.match(feedZh, /language: 'zh-CN'/);
	assert.match(feedEn, /language: 'en'/);
	assert.doesNotMatch(feedMixed, /language:/);
});

test('legacy rss.xml endpoints stay as aliases of the feed.xml endpoints', async () => {
	const read = (file: string) => readFile(path.resolve('src/pages', file), 'utf8');
	const [rssZh, rssEn, rssMixed] = await Promise.all([
		read('rss-zh.xml.ts'),
		read('rss-en.xml.ts'),
		read('rss.xml.ts'),
	]);

	assert.match(rssZh, /export \{ GET \} from '\.\/feed-zh\.xml'/);
	assert.match(rssEn, /export \{ GET \} from '\.\/feed-en\.xml'/);
	assert.match(rssMixed, /export \{ GET \} from '\.\/feed\.xml'/);
});
