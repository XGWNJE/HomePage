import { resolve } from 'node:path';
import { glob, type Loader } from 'astro/loaders';

import { loadHumanAgencyEntries } from './humanAgencyLoader.js';

const markdownBlogLoader = glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' });

export function blogWithJournalLoader(): Loader {
	const contentDirectory = resolve('src', 'content', 'human-agency');
	const previewPackage = process.env.JOURNAL_PREVIEW_PACKAGE;

	return {
		name: previewPackage ? 'blog-with-journal-preview-loader' : 'blog-with-journal-loader',
		load: async (context) => {
			await markdownBlogLoader.load(context);
			const records = await loadHumanAgencyEntries({ previewPackage, contentDirectory });

			for (const { entry, publishedAt } of records) {
				if (context.store.get(entry.slug)) {
					throw new Error(`Journal article slug collides with an existing blog post: ${entry.slug}.`);
				}
				const data = await context.parseData({
					id: entry.slug,
					data: {
						title: entry.title,
						description: entry.core_question,
						pubDate: publishedAt,
						tags: ['消化'],
						important: false,
						importantOrder: 0,
						lang: entry.language === 'zh-CN' ? 'cn' : 'en',
						group: entry.slug,
						category: '消化',
						draft: false,
					},
				});
				context.store.set({
					id: entry.slug,
					data,
					body: entry.body_markdown,
					rendered: await context.renderMarkdown(entry.body_markdown),
					digest: entry.entry_hash,
				});
			}

			context.logger.info(
				previewPackage
					? `Loaded ${records.length} approved Journal preview article${records.length === 1 ? '' : 's'} into the blog.`
					: `Loaded ${records.length} published Journal article${records.length === 1 ? '' : 's'} into the blog.`,
			);
		},
	};
}
