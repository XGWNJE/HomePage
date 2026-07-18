import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CollectionEntry } from 'astro:content';

import { createPublishedPostsQuery, filterPublishedPosts } from '../src/utils/publishedPosts.ts';
import { groupPostsByArticle } from '../src/utils/postAnalytics.ts';
import { getRelatedPosts } from '../src/utils/posts.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asBlogPost = (post: unknown) => post as CollectionEntry<'blog'>;

test('filterPublishedPosts excludes only posts explicitly marked as drafts', () => {
	const posts = [
		{ id: 'published-default', data: {} },
		{ id: 'published-explicit', data: { draft: false } },
		{ id: 'draft', data: { draft: true } },
	];

	assert.deepEqual(
		filterPublishedPosts(posts).map((post) => post.id),
		['published-default', 'published-explicit'],
	);
});

test('createPublishedPostsQuery applies the publication policy to loaded posts', async () => {
	const query = createPublishedPostsQuery(async () => [
		{ id: 'published', data: { draft: false } },
		{ id: 'draft', data: { draft: true } },
	]);

	assert.deepEqual(
		(await query()).map((post) => post.id),
		['published'],
	);
});

test('getRelatedPosts never recommends a draft', () => {
	const current = {
		id: 'current-en',
		data: { lang: 'en', tags: ['shared', 'strong-match'], pubDate: new Date('2026-07-01') },
	};
	const draft = {
		id: 'draft-en',
		data: { draft: true, lang: 'en', tags: ['shared', 'strong-match'], pubDate: new Date('2026-07-03') },
	};
	const published = {
		id: 'published-en',
		data: { lang: 'en', tags: ['shared'], pubDate: new Date('2026-07-02') },
	};

	assert.deepEqual(
		getRelatedPosts(asBlogPost(current), [asBlogPost(draft), asBlogPost(published)], 4).map((post) => post.id),
		['published-en'],
	);
});

test('article language variants stay together when pages are split into six groups', () => {
	const posts = Array.from({ length: 7 }, (_, index) =>
		(['cn', 'en'] as const).map((lang) => asBlogPost({
			id: `group-${index + 1}-${lang}`,
			data: { group: `group-${index + 1}`, lang },
		})),
	).flat();
	const groups = groupPostsByArticle(posts);

	assert.equal(groups.length, 7);
	assert.deepEqual(groups.slice(0, 6).flat().map((post) => post.id), posts.slice(0, 12).map((post) => post.id));
	assert.deepEqual(groups.slice(6).flat().map((post) => post.id), ['group-7-cn', 'group-7-en']);
});

test('home and blog pagination apply limits to article groups', async () => {
	const [home, blog, paginatedBlog] = await Promise.all([
		readFile(path.join(repositoryRoot, 'src/pages/index.astro'), 'utf8'),
		readFile(path.join(repositoryRoot, 'src/pages/blog/index.astro'), 'utf8'),
		readFile(path.join(repositoryRoot, 'src/pages/blog/page/[...page].astro'), 'utf8'),
	]);

	assert.match(home, /groupPostsByArticle[\s\S]*\.slice\(0, 6\)\.flat\(\)/);
	assert.match(blog, /postGroups\.slice\(0, PAGE_SIZE\)\.flat\(\)/);
	assert.match(blog, /Math\.ceil\(postGroups\.length \/ PAGE_SIZE\)/);
	assert.match(paginatedBlog, /paginate\(postGroups, \{ pageSize: PAGE_SIZE \}\)/);
});

test('every public blog reader uses the shared published-post query', async () => {
	const readers = [
		'src/pages/index.astro',
		'src/pages/blog/index.astro',
		'src/pages/blog/important.astro',
		'src/pages/blog/archive.astro',
		'src/pages/blog/page/[...page].astro',
		'src/pages/blog/[...slug].astro',
		'src/pages/tags/index.astro',
		'src/pages/tags/[tag].astro',
		'src/utils/rss.ts',
	];

	for (const reader of readers) {
		const source = await readFile(path.join(repositoryRoot, reader), 'utf8');
		assert.match(source, /getPublishedPosts/, `${reader} must use getPublishedPosts`);
		assert.doesNotMatch(
			source,
			/getCollection\s*\(\s*['"]blog['"]\s*\)/,
			`${reader} must not read the unfiltered blog collection`,
		);
	}
});
