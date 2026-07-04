import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const posts = defineCollection({
  loader: glob({ base: "./src/content/posts", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    pubDate: z.coerce.date(),
    contentType: z.enum(["note", "video", "work"]),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    sourceUrl: z.string().url().optional(),
    signal: z.string().optional(),
  }),
});

export const collections = { posts };
