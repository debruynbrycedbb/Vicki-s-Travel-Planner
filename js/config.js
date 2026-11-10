// Settings for Vicki's Travel Planner. Everything here is safe to publish.
// - API_URL: the address of the Cloudflare Worker (e.g. https://vickis-travel-planner-api.<you>.workers.dev).
//   Secrets (family code, signing key) live in the Worker's settings, never here.
// - MapTiler: lock the key to your site's address in MapTiler → API keys → Allowed HTTP origins.
// While API_URL is empty the site runs in demo mode (saved in this browser only).

export const CONFIG = {
  API_URL: 'https://vickis-travel-planner-api.debruynbryce-dbb.workers.dev',
  ADMIN_NAME: 'Bryce',         // who family members ask when they forget their password

  MAPTILER_KEY: 'l8ZthNQ0Xefn8MkvrsNE',
  MAP_STYLE: 'topo-v2',        // natural colours: blue sea, shaded relief
  SATELLITE_STYLE: 'hybrid',   // satellite photos with place names

  PHOTO_MAX_EDGE: 2048,        // longest side of a saved photo, in pixels
  THUMB_MAX_EDGE: 480,
  DEFAULT_CURRENCY: 'EUR',
};

export const VERSION = '2';
