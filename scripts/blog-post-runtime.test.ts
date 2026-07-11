import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFile(path.resolve(file), 'utf8');

test('BlogPost delegates browser behavior to a typed runtime entrypoint', async () => {
	const [layout, runtime] = await Promise.all([
		read('src/layouts/BlogPost.astro'),
		read('src/client/blog-post/runtime.ts'),
	]);

	assert.match(layout, /mountBlogPostRuntime/);
	assert.doesNotMatch(layout, /<script is:inline>/);
	assert.doesNotMatch(layout, /window\.__(?:toc|imgLightbox|backToTop|activePostViews|blogPostEvents)/);
	assert.match(runtime, /astro:page-load/);
	assert.match(runtime, /astro:before-swap/);
	assert.match(runtime, /combineCleanups/);
	assert.match(runtime, /cleanupBlogPostRuntime/);
	assert.match(runtime, /pageRoot === activePageRoot/);
});

test('Blog post features own cleanup for page transitions', async () => {
	const [toc, fades, lightbox, backToTop, views, codeActions] = await Promise.all([
		read('src/client/blog-post/toc-active.ts'),
		read('src/client/blog-post/toc-fades.ts'),
		read('src/client/blog-post/image-lightbox.ts'),
		read('src/client/blog-post/back-to-top.ts'),
		read('src/client/blog-post/views.ts'),
		read('src/client/blog-post/code-actions.ts'),
	]);

	assert.match(toc, /observer\?\.disconnect\(\)/);
	assert.match(toc, /removeEventListener/);
	assert.match(fades, /cancelAnimationFrame/);
	assert.match(lightbox, /unlockBody/);
	assert.match(lightbox, /removeEventListener/);
	assert.match(backToTop, /clearIdleTimer/);
	assert.match(backToTop, /removeEventListener/);
	assert.match(views, /AbortController/);
	assert.match(views, /controller\.abort\(\)/);
	assert.match(codeActions, /actionBar\.remove\(\)/);
	assert.match(codeActions, /copyTimer/);
});
