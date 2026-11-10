// The world map behind every screen: painted/satellite styles, pins, routes, picking a spot.
import { CONFIG } from './config.js?v=2';
import { h, toast } from './ui.js?v=2';

const maplibregl = window.maplibregl;
const STYLE_KEY = 'vtp:mapStyle';
const hasKey = !!CONFIG.MAPTILER_KEY;

function styleUrl(mode) {
  if (!hasKey) return 'https://tiles.openfreemap.org/styles/liberty';
  const id = mode === 'satellite' ? CONFIG.SATELLITE_STYLE : CONFIG.MAP_STYLE;
  return `https://api.maptiler.com/maps/${id}/style.json?key=${encodeURIComponent(CONFIG.MAPTILER_KEY)}`;
}

let map;
let mode = 'painted';
let insets = () => ({ top: 80, right: 40, bottom: 40, left: 40 });
let markers = [];
let route = { type: 'FeatureCollection', features: [] };
let picking = null;
let contextHandler = null;

export function getMap() { return map; }
export function setInsets(fn) { insets = fn; }

export function initMap(container) {
  try { mode = localStorage.getItem(STYLE_KEY) === 'satellite' && hasKey ? 'satellite' : 'painted'; } catch {}
  map = new maplibregl.Map({
    container,
    style: styleUrl(mode),
    center: [10, 30],
    zoom: window.innerWidth < 700 ? 0.6 : 1.6,
    attributionControl: { compact: true },
    maxPitch: 60,
    dragRotate: false,
    renderWorldCopies: false,
  });
  map.touchZoomRotate.disableRotation();
  map.on('style.load', () => {
    try {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#a9cbe0',
        'horizon-color': '#dce8ec',
        'fog-color': '#e9eef0',
        'sky-horizon-blend': 0.6,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
      });
    } catch (e) { console.warn('Globe view not available', e); }
    addRouteLayers();
  });
  map.on('error', (e) => {
    const status = e?.error?.status;
    if (status === 403 || status === 401) toast('The map key was refused. Check the MapTiler key and its allowed addresses.', 'error');
  });
  map.on('click', (e) => {
    if (picking) { const p = picking; picking = null; endPickUI(); p.resolve({ lat: e.lngLat.lat, lng: e.lngLat.lng }); }
  });
  map.on('contextmenu', (e) => {
    if (contextHandler && !picking) contextHandler({ lat: e.lngLat.lat, lng: e.lngLat.lng, point: e.point });
  });
  return map;
}

export function onMapContext(fn) { contextHandler = fn; }

export const mapMode = () => mode;
export function setMapMode(next) {
  if (next === mode) return;
  if (next === 'satellite' && !hasKey) { toast('Satellite view needs the MapTiler key (see README).', 'error'); return; }
  mode = next;
  try { localStorage.setItem(STYLE_KEY, mode); } catch {}
  map.setStyle(styleUrl(mode));
  document.dispatchEvent(new CustomEvent('mapmode', { detail: mode }));
}

// ---------- Pins ----------
// pin: { lat, lng, variant: 'upcoming'|'now'|'past'|'wishlist'|'stop', label, colour, title, onClick, active }
export function setPins(pins) {
  for (const m of markers) m.remove();
  markers = pins.map((p) => {
    const el = h('button', {
      type: 'button',
      // MapLibre positions this element with its own transform: never style or animate
      // the element's transform, only the dot inside it.
      class: `pin pin-${p.variant}${p.active ? ' is-active' : ''}${p.label ? ' has-label' : ''}`,
      'aria-label': p.title,
      title: p.title,
      style: p.colour ? `--pin:${p.colour}` : null,
      onclick: (e) => { e.stopPropagation(); p.onClick?.(); },
    }, h('span', { class: 'pin-dot', 'aria-hidden': 'true' }, p.label ? h('span', { class: 'pin-label' }, p.label) : null));
    return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
  });
}

// ---------- Route lines (one colour per day) ----------
function addRouteLayers() {
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: route });
  if (!map.getLayer('route-casing')) {
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fffaf0', 'line-width': 6, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['!', ['get', 'between']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': 3 } });
    map.addLayer({ id: 'route-between', type: 'line', source: 'route', filter: ['get', 'between'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': 2.5, 'line-dasharray': [1.5, 2] } });
  }
}
// segments: [{ coords: [[lng,lat],...], colour, between: bool }]
export function setRoute(segments = []) {
  route = {
    type: 'FeatureCollection',
    features: segments.filter((s) => s.coords.length > 1).map((s) => ({
      type: 'Feature', properties: { colour: s.colour, between: !!s.between },
      geometry: { type: 'LineString', coordinates: s.coords },
    })),
  };
  map.getSource('route')?.setData(route);
}

// ---------- Camera ----------
export function fitTo(points, { maxZoom = 12, duration = 1200 } = {}) {
  if (!points.length) return;
  if (points.length === 1) { flyTo(points[0], Math.min(maxZoom, 11), duration); return; }
  const b = new maplibregl.LngLatBounds();
  for (const p of points) b.extend([p.lng, p.lat]);
  map.fitBounds(b, { padding: insets(), maxZoom, duration });
}
export function flyTo(p, zoom = 12, duration = 1600) {
  return new Promise((resolve) => {
    map.once('moveend', resolve);
    map.flyTo({ center: [p.lng, p.lat], zoom, duration, padding: insets(), essential: true });
  });
}
export function worldView() {
  map.easeTo({ center: [10, 30], zoom: window.innerWidth < 700 ? 0.6 : 1.6, padding: insets(), duration: 1200 });
}

// ---------- Pick a spot on the map ----------
let pickBanner;
function endPickUI() { pickBanner?.remove(); pickBanner = null; map.getCanvas().style.cursor = ''; document.body.classList.remove('is-picking'); }
export function pickPoint(message = 'Click the map to place the pin') {
  if (picking) picking.resolve(null);
  document.body.classList.add('is-picking');
  map.getCanvas().style.cursor = 'crosshair';
  pickBanner = h('div', { class: 'pick-banner', role: 'status' },
    h('span', {}, message),
    h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => { const p = picking; picking = null; endPickUI(); p?.resolve(null); } }, 'Cancel'));
  document.body.append(pickBanner);
  return new Promise((resolve) => { picking = { resolve }; });
}

export function resize() { map?.resize(); }
