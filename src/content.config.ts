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
      'vocabulary',
    ]),
    // Thematic grouping above the flat lesson list. Keep in sync with UNITS in
    // src/lib/lessons.ts (that file owns the human labels + display order).
    unit: z.enum(['grund', 'falske-venner', 'system', 'hverdag']),
    order: z.number().int(),
    summary: z.string(),
    estMinutes: z.number().int().positive(),
    // What the learner should be able to do after the lesson (rendered at top).
    objectives: z.array(z.string()).default([]),
    // Lesson ids (filename without extension) the learner should do first.
    prerequisites: z.array(z.string()).default([]),
    // Flashcard tags this lesson drills. Every tag MUST resolve to >=1 card —
    // enforced by scripts/check-content.mjs (prebuild). Leave empty for
    // prose-only lessons with no deck yet.
    vocabTags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { lessons };
