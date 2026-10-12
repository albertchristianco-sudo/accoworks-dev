// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

// https://astro.build/config
// React is registered so islands can be added later. Pages that do not use an
// island ship no React; `npm run check:no-react` enforces that after a build.
export default defineConfig({
  site: isGitHubPages
    ? 'https://albertchristianco-sudo.github.io'
    : 'https://accoworks.dev',
  base: isGitHubPages ? '/accoworks-dev/' : '/',
  integrations: [mdx(), react()],
});
