const navOrder: Record<string, number> = { '': 0, blog: 1, tags: 2, links: 3, about: 4 };
let initialized = false;
let revealObserver: IntersectionObserver | null = null;

const routeSegment = (url: URL): string =>
	url.pathname.split('/').filter(Boolean).filter((part) => part !== 'HomePage')[0] || '';

export const getNavigationDirection = (from: URL, to: URL): 'forward' | 'back' | null => {
	const fromIndex = navOrder[routeSegment(from)];
	const toIndex = navOrder[routeSegment(to)];
	if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) return null;
	return toIndex > fromIndex ? 'forward' : 'back';
};

const ensureRevealObserver = (): IntersectionObserver => {
	if (revealObserver) return revealObserver;
	revealObserver = new IntersectionObserver((entries, observer) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			entry.target.classList.add('revealed');
			observer.unobserve(entry.target);
		}
	}, { rootMargin: '0px 0px -7% 0px', threshold: 0.06 });
	return revealObserver;
};

export const scanReveals = (): void => {
	document.documentElement.classList.add('js-reveal');
	const observer = ensureRevealObserver();
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
	document.querySelectorAll<HTMLElement>('[data-reveal]:not(.revealed)').forEach((element) => {
		const rect = element.getBoundingClientRect();
		if (rect.top < viewportHeight * 0.95 && rect.bottom > -1) element.classList.add('revealed');
		else observer.observe(element);
	});
};

export const initPolish = (): void => {
	if (initialized) return;
	initialized = true;
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (!reducedMotion && 'IntersectionObserver' in window) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', scanReveals, { once: true });
		} else {
			scanReveals();
		}
		document.addEventListener('astro:page-load', scanReveals);
		document.addEventListener('astro:after-swap', scanReveals);
	}

	document.addEventListener('astro:before-preparation', ((event: Event & { from: URL; to: URL }) => {
		const root = document.documentElement;
		delete root.dataset.navDir;
		const direction = getNavigationDirection(event.from, event.to);
		if (direction) root.dataset.navDir = direction;
	}) as EventListener);

	if (!window.matchMedia('(pointer: fine)').matches) return;
	let animationFrame = 0;
	let lastPointerEvent: PointerEvent | null = null;
	const applySpotlight = (): void => {
		animationFrame = 0;
		const event = lastPointerEvent;
		const card = event?.target instanceof Element
			? event.target.closest<HTMLElement>('.card-spotlight')
			: null;
		if (!event || !card) return;
		const rect = card.getBoundingClientRect();
		card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
		card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
	};
	document.addEventListener('pointermove', (event) => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		lastPointerEvent = event;
		if (!animationFrame) animationFrame = requestAnimationFrame(applySpotlight);
	}, { passive: true });
};
