import type { CollectionEntry } from 'astro:content';

export function getPostLang(post: CollectionEntry<'blog'>): 'cn' | 'en' | undefined {
	const lang = post.data.lang;
	if (lang === 'cn' || lang === 'en') return lang;
	const matched = post.id.match(/-(cn|en)$/)?.[1];
	return matched === 'cn' || matched === 'en' ? matched : undefined;
}

export function getPostAnalyticsKey(post: CollectionEntry<'blog'>): string {
	const lang = getPostLang(post);
	const baseGroup = post.data.group ?? post.id.replace(/-(cn|en)$/, '');
	return lang ? `${baseGroup}-${lang}` : baseGroup;
}
