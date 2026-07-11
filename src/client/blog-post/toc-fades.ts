import type { Cleanup } from './lifecycle';

export function initTocScrollFades(): Cleanup {
	const selector = window.innerWidth < 768 ? '[data-toc="drawer"]' : '[data-toc="sidebar"]';
	const tocContainer = document.querySelector(selector);
	const wrap = tocContainer?.querySelector('[data-toc-fade-wrap]');
	if (!wrap) return () => {};

	const container = wrap.querySelector<HTMLElement>('[data-toc-scroll]');
	const topFade = wrap.querySelector<HTMLElement>('[data-toc-fade="top"]');
	const bottomFade = wrap.querySelector<HTMLElement>('[data-toc-fade="bottom"]');
	if (!container || !topFade || !bottomFade) return () => {};

	const epsilon = 1;
	let rafId = 0;
	const applyFadeState = () => {
		rafId = 0;
		const canScroll = container.scrollHeight - container.clientHeight > epsilon;
		const showTop = canScroll && container.scrollTop > epsilon;
		const showBottom = canScroll && container.scrollTop + container.clientHeight < container.scrollHeight - epsilon;
		topFade.classList.toggle('opacity-100', showTop);
		topFade.classList.toggle('opacity-0', !showTop);
		bottomFade.classList.toggle('opacity-100', showBottom);
		bottomFade.classList.toggle('opacity-0', !showBottom);
	};
	const scheduleFadeUpdate = () => {
		if (!rafId) rafId = requestAnimationFrame(applyFadeState);
	};

	container.addEventListener('scroll', scheduleFadeUpdate, { passive: true });
	window.addEventListener('resize', applyFadeState);
	window.addEventListener('toc:refresh', applyFadeState);
	applyFadeState();

	return () => {
		container.removeEventListener('scroll', scheduleFadeUpdate);
		window.removeEventListener('resize', applyFadeState);
		window.removeEventListener('toc:refresh', applyFadeState);
		if (rafId) cancelAnimationFrame(rafId);
	};
}
