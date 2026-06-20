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
  integrations: [svelte(), mdx(), sitemap()],
});
