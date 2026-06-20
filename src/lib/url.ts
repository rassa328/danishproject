// Centralized base-path helper. Astro does NOT auto-prefix plain <a href>,
// asset URLs, or island runtime fetches with `base`, so everything internal
// must route through withBase() or it 404s on GitHub Pages (works locally).
// import.meta.env.BASE_URL is the configured base, normally with a trailing slash.
const BASE = import.meta.env.BASE_URL;

export function withBase(path = ''): string {
  const base = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  const rest = String(path).replace(/^\//, '');
  return rest ? `${base}/${rest}` : `${base}/`;
}
