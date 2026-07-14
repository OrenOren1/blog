import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    meta_title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    date: z.coerce.date(),
    image: z.string().optional().nullable(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    author: z.string().default("Oren Sultan"),
    draft: z.boolean().default(false),
    aliases: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    unlisted: z.boolean().default(false),
    source: z
      .enum(["general", "kubernetes", "gitops", "ai-ml", "platform"])
      .default("general"),
    updated_date: z.coerce.date().optional(),
  }),
});

export const collections = { blog };