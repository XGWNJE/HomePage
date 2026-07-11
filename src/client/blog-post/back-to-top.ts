import type { Cleanup } from './lifecycle';

export function initBackToTop(): Cleanup {
	const button = document.querySelector<HTMLElement>('[data-back-to-top]');
	if (!button) return () => {};

	const ring = button.querySelector<SVGElement>('[data-back-to-top-progress]');
	const circumference = 2 * Math.PI * 21;
	if (ring) {
		ring.style.strokeDasharray = String(circumference);
		ring.style.strokeDashoffset = String(circumference);
	}

	let rafId = 0;
	let idleTimer = 0;
	const clearIdleTimer = () => {
		if (idleTimer) window.clearTimeout(idleTimer);
		idleTimer = 0;
	};
	const hideAfterIdle = () => {
		clearIdleTimer();
		idleTimer = window.setTimeout(() => {
			idleTimer = 0;
			if (button.dataset.held !== 'true') button.classList.remove('is-visible');
		}, 3000);
	};
	const update = () => {
		rafId = 0;
		const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
		const progress = Math.min(1, Math.max(0, window.scrollY / max));
		if (window.scrollY > 480) {
			button.classList.add('is-visible');
			hideAfterIdle();
		} else {
			clearIdleTimer();
			button.classList.remove('is-visible');
		}
		if (ring) ring.style.strokeDashoffset = String(circumference * (1 - progress));
	};
	const schedule = () => {
		if (!rafId) rafId = requestAnimationFrame(update);
	};
	const hold = () => {
		button.dataset.held = 'true';
		clearIdleTimer();
		if (window.scrollY > 480) button.classList.add('is-visible');
	};
	const release = () => {
		button.dataset.held = 'false';
		if (window.scrollY > 480) hideAfterIdle();
	};
	const scrollToTop = () => {
		const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
		window.scrollTo({ top: 0, behavior });
	};

	button.addEventListener('pointerenter', hold);
	button.addEventListener('focusin', hold);
	button.addEventListener('pointerleave', release);
	button.addEventListener('focusout', release);
	button.addEventListener('click', scrollToTop);
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule);
	update();

	return () => {
		button.removeEventListener('pointerenter', hold);
		button.removeEventListener('focusin', hold);
		button.removeEventListener('pointerleave', release);
		button.removeEventListener('focusout', release);
		button.removeEventListener('click', scrollToTop);
		window.removeEventListener('scroll', schedule);
		window.removeEventListener('resize', schedule);
		if (rafId) cancelAnimationFrame(rafId);
		clearIdleTimer();
		delete button.dataset.held;
	};
}
