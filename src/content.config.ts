import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
    loader: glob({
        pattern: "**/*.md",
        base: "./src/content/projects"
    }),
    schema: z.object({
        title: z.string(),
        summary: z.string(),
        tags: z.array(z.string()),
        image: z.string().optional(),
        imageAlt: z.string().optional(),
        repo: z.string().optional(),
        video: z.string().optional(),
        featured: z.boolean().default(false),
        order: z.number().default(100),
    }),
});

export const collections = { projects };