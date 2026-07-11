import { initBackToTop } from './back-to-top';
import { initCodeActions } from './code-actions';
import { initImageLightbox } from './image-lightbox';
import { combineCleanups, noopCleanup, type Cleanup } from './lifecycle';
import { initScrollRestoration, resetPageScrollLocks } from './scroll-restoration';
import { initTocActiveState } from './toc-active';
import { initTocScrollFades } from './toc-fades';
import { initPostViews } from './views';

let pageCleanup: Cleanup = noopCleanup;
let lifecycleBound = false;
let activePageRoot: Element | null = null;

function getBlogPostPageRoot(): Element | null {
	return document.querySelector('.markdown-prose');
}

export function cleanupBlogPostRuntime(): void {
	pageCleanup();
	pageCleanup = noopCleanup;
	activePageRoot = null;
}

export function initBlogPostRuntime(): void {
	const pageRoot = getBlogPostPageRoot();
	if (pageRoot && pageRoot === activePageRoot) return;
	cleanupBlogPostRuntime();
	resetPageScrollLocks();
	if (!pageRoot) return;
	activePageRoot = pageRoot;

	pageCleanup = combineCleanups([
		initScrollRestoration(),
		initTocActiveState(),
		initTocScrollFades(),
		initImageLightbox(),
		initBackToTop(),
		initPostViews(),
		initCodeActions(),
	]);
}

export function mountBlogPostRuntime(): void {
	if (!lifecycleBound) {
		document.addEventListener('astro:page-load', initBlogPostRuntime);
		document.addEventListener('astro:before-swap', cleanupBlogPostRuntime);
		lifecycleBound = true;
	}
	initBlogPostRuntime();
}
