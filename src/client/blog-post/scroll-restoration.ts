import type { Cleanup } from './lifecycle';

export function resetPageScrollLocks(): void {
	document.documentElement.classList.remove('overflow-hidden');
	const topOffset = Number.parseInt(document.body.style.top || '0', 10);
	const shouldRestoreBody = document.body.style.position === 'fixed';
	if (!shouldRestoreBody) return;

	document.body.style.position = '';
	document.body.style.top = '';
	document.body.style.left = '';
	document.body.style.right = '';
	document.body.style.width = '';
	document.body.style.overflow = '';
	if (!Number.isNaN(topOffset) && topOffset < 0) {
		window.scrollTo(0, Math.abs(topOffset));
	}
}

export function initScrollRestoration(): Cleanup {
	try {
		if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
	} catch {}

	let firstFrame = 0;
	let secondFrame = 0;
	if (!window.location.hash) {
		firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => window.scrollTo(0, 0));
		});
	}

	return () => {
		if (firstFrame) cancelAnimationFrame(firstFrame);
		if (secondFrame) cancelAnimationFrame(secondFrame);
	};
}
