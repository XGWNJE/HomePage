import type { CollectionEntry } from 'astro:content';

export function getPostLang(post: CollectionEntry<'blog'>): 'cn' | 'en' | undefined {
	const lang = post.data.lang;
	if (lang === 'cn' || lang === 'en') return lang;
	const matched = post.id.match(/-(cn|en)$/)?.[1];
	return matched === 'cn' || matched === 'en' ? matched : undefined;
}

export function getPostGroupKey(post: CollectionEntry<'blog'>): string {
	return post.data.group ?? post.id.replace(/-(cn|en)$/, '');
}

export function groupPostsByArticle(
	posts: readonly CollectionEntry<'blog'>[],
): CollectionEntry<'blog'>[][] {
	const groups = new Map<string, CollectionEntry<'blog'>[]>();
	for (const post of posts) {
		const group = getPostGroupKey(post);
		const groupPosts = groups.get(group);
		if (groupPosts) groupPosts.push(post);
		else groups.set(group, [post]);
	}
	return [...groups.values()];
}

export function getPostAnalyticsKey(post: CollectionEntry<'blog'>): string {
	const lang = getPostLang(post);
	const baseGroup = getPostGroupKey(post);
	return lang ? `${baseGroup}-${lang}` : baseGroup;
}
