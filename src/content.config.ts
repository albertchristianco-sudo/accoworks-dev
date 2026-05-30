import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const fieldNotes = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/field-notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    label: z.enum(['Training', 'Building', 'Operating']),
    summary: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  'field-notes': fieldNotes,
};
