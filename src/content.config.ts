import { defineCollection } from 'astro:content';
import { z } from 'astro/zod'; // Astro 6: z moved out of astro:content
import { glob } from 'astro/loaders';

const lessons = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/lessons' }),
  schema: z.object({
    title: z.string(),
    level: z.enum(['b1', 'b2']),
    topic: z.enum([
      'pronunciation',
      'false-friends',
      'numbers',
      'spelling',
      'listening',
      'grammar',
      'idiom',
    ]),
    order: z.number().int(),
    summary: z.string(),
    estMinutes: z.number().int().positive(),
    vocabTags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { lessons };
