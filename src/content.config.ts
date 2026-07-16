import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { blogWithJournalLoader } from './content/blogWithJournalLoader';

const blog = defineCollection({
	// Load normal Markdown/MDX plus approved Journal entries adapted as ordinary posts.
	loader: blogWithJournalLoader(),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			tags: z.array(z.string()).optional(),
			important: z.boolean().default(false),
			importantOrder: z.number().int().default(0),
			heroImage: image().optional(),
			// Language and grouping for bilingual posts
			lang: z.enum(['cn', 'en']).optional(),
			group: z.string().optional(),
			author: z.string().optional(),
			category: z.string().optional(),
			slug: z.string().optional(),
			draft: z.boolean().default(false),
			// For Typora image path compatibility
			'typora-root-url': z.string().optional(),
		}),
});

export const collections = { blog };
