// Things Ac builds. Copy comes from the approved personal content brief.
// Only link destinations that are public and verified; private work stays unlinked.

export type Project = {
  name: string;
  summary: string;
  status: string;
  link?: { href: string; label: string };
};

export const leadProject: Project = {
  name: 'Will I have a power interruption?',
  summary:
    'A free tracker for scheduled Visayan Electric outages in Cebu City, Mandaue, Talisay and nearby towns: when it starts, how long it lasts, and when power returns.',
  status: 'Live, public',
  link: { href: '/power/', label: 'Check your barangay' },
};

export const projects: Project[] = [
  {
    name: 'Character Forge',
    summary: 'A D&D 2024 character builder for levels 1 to 6. Every number is calculated for you, and the sheet prints to PDF.',
    status: 'Live, public',
    link: { href: 'https://forge.accoworks.dev/', label: 'Open Character Forge' },
  },
  {
    name: 'accoworks.dev',
    summary: 'This site and its publishing system.',
    status: 'Live, open source',
    link: { href: 'https://github.com/albertchristianco-sudo/accoworks-dev', label: 'View the source' },
  },
  {
    name: 'Cortex Orchestrator',
    summary: 'Approval-gated agent operations: keeps consequential agent actions behind explicit approval before execution.',
    status: 'Active, private',
  },
  {
    name: 'Life Dashboard',
    summary:
      'A personal operations dashboard. Version 0.1 renders 2 of 8 planned adapters into one local view of training, business, and daily operations.',
    status: 'In progress, local only',
  },
  {
    name: 'Flame & Finish systems',
    summary: 'Inventory, ordering, reporting, and storefront work inside systems built for the trade business.',
    status: 'Active, internal',
  },
  {
    name: 'Gym programming automation',
    summary: 'Reduces repetitive platform entry while keeping programming decisions with the coach.',
    status: 'Active, internal',
  },
];

export const atHome = 'I also tinker with home servers and the solar setup at home.';
