// Finding places: search by name, reverse lookup, and reading coordinates from pasted links.
import { CONFIG } from './config.js?v=2';

const key = CONFIG.MAPTILER_KEY;

async function maptilerSearch(q) {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&limit=6&language=en`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('search failed');
  const j = await r.json();
  return j.features.map((f) => ({
    name: f.text || f.place_name,
    place: (f.place_name || '').replace(new RegExp(`^${escapeRe(f.text || '')},?\\s*`), ''),
    lng: f.center[0], lat: f.center[1],
  }));
}
async function nominatimSearch(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=en&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('search failed');
  const j = await r.json();
  return j.map((p) => {
    const parts = (p.display_name || '').split(', ');
    const name = p.name || parts[0];
    return { name, place: parts.filter((x) => x !== name).slice(0, 3).join(', '), lat: +p.lat, lng: +p.lon };
  });
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function searchPlaces(q) {
  const coords = parseCoords(q);
  if (coords) return [{ name: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, place: 'Coordinates', ...coords }];
  if (key) { try { return await maptilerSearch(q); } catch { /* fall back */ } }
  return nominatimSearch(q);
}

export async function reversePlace({ lat, lng }) {
  try {
    if (key) {
      const r = await fetch(`https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${encodeURIComponent(key)}&limit=1&language=en`);
      const f = (await r.json()).features?.[0];
      if (f) return { name: f.text || '', place: f.place_name || '' };
    }
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=en&zoom=16&lat=${lat}&lon=${lng}`);
    const j = await r.json();
    const parts = (j.display_name || '').split(', ');
    const name = j.name || parts[0] || '';
    return { name, place: parts.filter((x) => x !== name).slice(0, 3).join(', ') };
  } catch {
    return { name: '', place: '' };
  }
}

// "41.40, 2.17", Google Maps links (@lat,lng / q=lat,lng / !3d…!4d…), OpenStreetMap links.
export function parseCoords(text) {
  if (!text) return null;
  const t = decodeURIComponent(String(text).trim());
  const ok = (lat, lng) => (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);
  let m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/#map=\d+(?:\.\d+)?\/(-?\d+\.\d+)\/(-?\d+\.\d+)/);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return ok(+m[1], +m[2]);
  return null;
}

export const isShortGoogleLink = (t) => /maps\.app\.goo\.gl|goo\.gl\/maps/.test(t || '');

// Straight-line distance in km.
export function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
