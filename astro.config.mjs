// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

// https://astro.build/config
export default defineConfig({
  site: isGitHubPages
    ? 'https://albertchristianco-sudo.github.io'
    : 'https://accoworks.dev',
  base: isGitHubPages ? '/accoworks-dev/' : '/',
  integrations: [mdx()],
});