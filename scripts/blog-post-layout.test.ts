import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layoutUrl = new URL('../src/layouts/BlogPost.astro', import.meta.url);

test('article TOC requires at least two navigable headings', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /const hasToc = tocItems\.length >= 2;/u);
	assert.match(source, /<Header showTocButton=\{hasToc\} \/>/u);
});

test('TOC chrome renders only in TOC mode', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /\{hasToc && <TocDrawer headings=\{tocItems\} \/>\}/u);
	assert.match(source, /metaMode !== 'page' && hasToc && \([\s\S]*?<TocSidebar headings=\{tocItems\} \/>/u);
	assert.doesNotMatch(source, /Placeholder keeps first paint geometry stable/u);
});

test('articles without useful navigation use a centered reading column', async () => {
	const source = await readFile(layoutUrl, 'utf8');
	assert.match(source, /hasToc[\s\S]*?'md:grid md:grid-cols-\[240px_minmax\(0,1fr\)\][\s\S]*?: 'mx-auto max-w-\[820px\]'/u);
});
