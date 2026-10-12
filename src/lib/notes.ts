import { getCollection, type CollectionEntry } from 'astro:content';

export type Note = CollectionEntry<'field-notes'>;

export const noteSlug = (note: Note) => note.id.replace(/\.mdx?$/, '');
export const noteHref = (note: Note) => `/field-notes/${noteSlug(note)}/`;

// Published notes, newest first.
export async function getNotes(): Promise<Note[]> {
  return (await getCollection('field-notes'))
    .filter((note) => !note.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

// Frontmatter dates are calendar days, parsed as UTC midnight.
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const shortDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// First sentence of a summary, used as the cover line dek.
export const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
