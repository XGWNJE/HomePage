import { formatCompactViewCount, formatFullViewCount, getApiBase, getI18nText } from './globals';
import type { Cleanup } from './lifecycle';

async function requestPostViews(slug: string, signal: AbortSignal): Promise<number> {
	const apiBase = getApiBase();
	const sessionKey = `blog_viewed:${slug}`;
	let hasViewedInSession = false;
	try {
		hasViewedInSession = sessionStorage.getItem(sessionKey) === '1';
	} catch {}

	try {
		const response = hasViewedInSession
			? await fetch(`${apiBase}/api/views?post=${encodeURIComponent(slug)}`, { signal })
			: await fetch(`${apiBase}/api/views`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ post: slug }),
					signal,
				});
		if (response.ok) {
			const data = await response.json();
			if (!hasViewedInSession) {
				try {
					sessionStorage.setItem(sessionKey, '1');
				} catch {}
			}
			return Number(data?.views ?? 0);
		}
	} catch (error) {
		if (signal.aborted) throw error;
	}

	const fallback = await fetch(`${apiBase}/api/views?post=${encodeURIComponent(slug)}`, { signal });
	if (!fallback.ok) throw new Error('views_get_failed');
	const data = await fallback.json();
	return Number(data?.views ?? 0);
}

async function loadPostViews(signal: AbortSignal): Promise<void> {
	const root = document.querySelector<HTMLElement>('[data-post-views-root]');
	const output = document.querySelector<HTMLElement>('[data-post-views]');
	if (!root || !output) return;
	const slug = root.dataset.postViewsRoot || '';
	if (!slug) {
		output.textContent = `0 ${getI18nText('article.views', 'views')}`;
		return;
	}
	try {
		const count = await requestPostViews(slug, signal);
		if (!signal.aborted && output.isConnected) output.textContent = formatFullViewCount(count);
	} catch {
		if (!signal.aborted && output.isConnected) output.textContent = `0 ${getI18nText('article.views', 'views')}`;
	}
}

async function loadRelatedPostViews(signal: AbortSignal): Promise<void> {
	const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-related-post-views-root]'));
	if (roots.length === 0) return;
	const groups = new Map<string, HTMLElement[]>();
	for (const root of roots) {
		const key = root.dataset.relatedPostViewsRoot || '';
		if (!key) continue;
		const group = groups.get(key) || [];
		group.push(root);
		groups.set(key, group);
	}
	await Promise.all(
		Array.from(groups.entries()).map(async ([key, group]) => {
			let text = '0';
			try {
				const response = await fetch(`${getApiBase()}/api/views?post=${encodeURIComponent(key)}`, { signal });
				if (response.ok) {
					const data = await response.json();
					text = formatCompactViewCount(data?.views ?? 0);
				}
			} catch {}
			if (signal.aborted) return;
			for (const root of group) {
				const output = root.querySelector<HTMLElement>('[data-related-post-views]');
				if (output?.isConnected) output.textContent = text;
			}
		}),
	);
}

export function initPostViews(): Cleanup {
	const controller = new AbortController();
	void loadPostViews(controller.signal);
	void loadRelatedPostViews(controller.signal);
	return () => controller.abort();
}
