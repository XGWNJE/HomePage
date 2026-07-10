import type { CollectionEntry } from 'astro:content';

export interface DraftablePost {
	data: {
		draft?: boolean;
	};
}

export function filterPublishedPosts<T extends DraftablePost>(posts: readonly T[]): T[] {
	return posts.filter((post) => post.data.draft !== true);
}

export function createPublishedPostsQuery<T extends DraftablePost>(
	loadPosts: () => Promise<readonly T[]>,
): () => Promise<T[]> {
	return async () => filterPublishedPosts(await loadPosts());
}

async function loadBlogPosts(): Promise<CollectionEntry<'blog'>[]> {
	const { getCollection } = await import('astro:content');
	return getCollection('blog');
}

export const getPublishedPosts = createPublishedPostsQuery(loadBlogPosts);
