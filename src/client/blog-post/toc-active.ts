import type { Cleanup } from './lifecycle';

const ACTIVE_CLASSES = [
	'bg-zinc-100/55',
	'text-zinc-900',
	'border-zinc-400/90',
	'dark:bg-zinc-800/55',
	'dark:text-zinc-100',
	'dark:border-zinc-500/90',
];

function normalizeId(id: string): string {
	try {
		return decodeURIComponent(id);
	} catch {
		return id;
	}
}

function isElementVisible(element: Element): boolean {
	if (element.getClientRects().length === 0) return false;
	const style = window.getComputedStyle(element);
	return style.display !== 'none' && style.visibility !== 'hidden';
}

export function initTocActiveState(): Cleanup {
	const links = Array.from(document.querySelectorAll<HTMLElement>('[data-toc-link]'));
	const headings = Array.from(
		document.querySelectorAll<HTMLElement>('.markdown-prose h2[id], .markdown-prose h3[id], .markdown-prose h4[id]'),
	);
	if (links.length === 0 || headings.length === 0) return () => {};

	const linkMap = new Map<string, HTMLElement[]>();
	for (const link of links) {
		const id = normalizeId(link.dataset.tocLink || '');
		if (!id) continue;
		const group = linkMap.get(id) || [];
		group.push(link);
		linkMap.set(id, group);
	}

	const clearActive = () => {
		for (const link of links) {
			link.classList.remove(...ACTIVE_CLASSES);
			link.removeAttribute('aria-current');
		}
	};
	const ensureVisibleInToc = (link: HTMLElement) => {
		const container = link.closest<HTMLElement>('[data-toc-scroll]');
		if (!container || !isElementVisible(link) || !isElementVisible(container)) return;
		const containerRect = container.getBoundingClientRect();
		const linkRect = link.getBoundingClientRect();
		if (linkRect.top < containerRect.top || linkRect.bottom > containerRect.bottom) {
			link.scrollIntoView({ block: 'nearest' });
		}
	};
	const setActive = (id: string) => {
		clearActive();
		if (!id) return;
		for (const link of linkMap.get(normalizeId(id)) || []) {
			link.classList.add(...ACTIVE_CLASSES);
			link.setAttribute('aria-current', 'true');
			ensureVisibleInToc(link);
		}
	};

	let observer: IntersectionObserver | null = null;
	let rafId = 0;
	let currentId = '';
	let usesScrollFallback = false;
	const updateActive = () => {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			let newId = '';
			for (const heading of headings) {
				if (heading.getBoundingClientRect().top <= 140) newId = heading.id;
			}
			if (!newId && headings[0]?.getBoundingClientRect().top > 140) newId = headings[0].id;
			if (newId && newId !== currentId) {
				currentId = newId;
				setActive(newId);
			}
		});
	};
	const syncVisibleTocActive = () => {
		if (currentId && linkMap.has(normalizeId(currentId))) setActive(currentId);
		else updateActive();
	};
	const onHashChange = () => {
		const id = normalizeId(window.location.hash.replace(/^#/, ''));
		if (!id || !linkMap.has(id)) return;
		currentId = id;
		setActive(id);
	};

	try {
		observer = new IntersectionObserver(
			(entries) => {
				let topmost: Element | null = null;
				let topmostTop = Number.POSITIVE_INFINITY;
				for (const entry of entries) {
					const top = entry.target.getBoundingClientRect().top;
					if (entry.isIntersecting && top < topmostTop) {
						topmost = entry.target;
						topmostTop = top;
					}
				}
				if (!(topmost instanceof HTMLElement) || topmost.id === currentId) return;
				currentId = topmost.id;
				setActive(currentId);
			},
			{ rootMargin: '-140px 0px -60% 0px', threshold: 0 },
		);
		for (const heading of headings) observer.observe(heading);
	} catch {
		usesScrollFallback = true;
		window.addEventListener('scroll', updateActive, { passive: true });
	}

	window.addEventListener('resize', updateActive);
	window.addEventListener('hashchange', onHashChange);
	window.addEventListener('toc:sync-active', syncVisibleTocActive);
	const hashId = normalizeId(window.location.hash.replace(/^#/, ''));
	if (hashId && linkMap.has(hashId)) {
		currentId = hashId;
		setActive(hashId);
	} else if (!observer) {
		updateActive();
	}

	return () => {
		if (rafId) cancelAnimationFrame(rafId);
		observer?.disconnect();
		if (usesScrollFallback) window.removeEventListener('scroll', updateActive);
		window.removeEventListener('resize', updateActive);
		window.removeEventListener('hashchange', onHashChange);
		window.removeEventListener('toc:sync-active', syncVisibleTocActive);
	};
}
