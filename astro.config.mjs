// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// GitHub Pages project site: https://rassa328.github.io/danishproject/
// `base` is a hardcoded constant (single deploy target). All internal links,
// assets and island fetches must go through withBase() in src/lib/url.ts.
// https://astro.build/config
export default defineConfig({
  site: 'https://rassa328.github.io',
  base: '/danishproject',
  trailingSlash: 'ignore',
  output: 'static',
  // The word drill was briefly /skriv before becoming /zen (static
  // meta-refresh page). Astro prefixes `base` on the SOURCE route only —
  // the destination is emitted verbatim, so it must carry the base itself.
  redirects: { '/skriv': '/danishproject/zen' },
  integrations: [svelte(), mdx(), sitemap()],
});
