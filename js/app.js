// Vicki's Travel Planner: start-up, layout, navigation and the place search.
import { db, loadTrips } from './db.js?v=1';
import { h, $, icon, toast, attempt, openDialog, field, select, debounce, initials, brandMark, tripStatus, fmtRange, tripDays, dayLabel, KINDS } from './ui.js?v=1';
import { initMap, setInsets, onMapContext, flyTo, getMap, setMapMode, mapMode, worldView, setPins, setRoute, resize } from './map.js?v=1';
import { searchPlaces, reversePlace } from './places.js?v=1';
import { renderAuth } from './views/auth.js?v=1';
import { renderTrips } from './views/trips.js?v=1';
import { renderTrip } from './views/trip.js?v=1';
import { renderWishlist } from './views/wishlist.js?v=1';
import { renderPhotos } from './views/photos.js?v=1';
import { playTrip } from './play.js?v=1';
import { openAccount } from './account.js?v=1';

const mobileQuery = window.matchMedia('(max-width: 759px)');
const isMobile = () => mobileQuery.matches;

// ---------- Layout ----------
const panel = $('#panel');
const panelBody = h('div', { class: 'panel-body' });
const handle = h('button', { class: 'sheet-handle', type: 'button', 'aria-label': 'Resize panel' }, h('span'));
panel.append(handle, panelBody);
let sheet = 'half';

function setSheet(state) {
  sheet = state;
  panel.dataset.sheet = state;   // the map stays full-screen underneath, so no resize needed
}
handle.addEventListener('click', () => setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek'));
(() => {
  let startY = null, startH = 0;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; startH = panel.getBoundingClientRect().height; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY == null || Math.abs(e.clientY - startY) < 6) return;
    panel.style.transition = 'none';
    panel.style.height = `${Math.max(96, startH - (e.clientY - startY))}px`;
  });
  handle.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const moved = Math.abs(e.clientY - startY) >= 6;
    const hgt = panel.getBoundingClientRect().height / window.innerHeight;
    panel.style.transition = ''; panel.style.height = '';
    startY = null;
    if (moved) { e.preventDefault(); setSheet(hgt < 0.3 ? 'peek' : hgt < 0.72 ? 'half' : 'full'); handle.dataset.dragged = '1'; setTimeout(() => delete handle.dataset.dragged, 50); }
  });
  handle.addEventListener('click', (e) => { if (handle.dataset.dragged) e.stopImmediatePropagation(); }, true);
})();

setInsets(() => {
  if (isMobile()) {
    const ph = panel.hidden ? 0 : panel.getBoundingClientRect().height;
    return { top: 80, right: 30, left: 30, bottom: Math.min(ph + 24, window.innerHeight * 0.7) };
  }
  const pw = panel.hidden || panel.classList.contains('is-wide') ? 0 : panel.getBoundingClientRect().width;
  return { top: 90, right: 80, bottom: 50, left: pw + 60 };
});

export const app = {
  me: null,
  // Put a view in the side panel (or the wide panel for galleries).
  show(node, { wide = false, sheetState, keepScroll = false } = {}) {
    const scroll = panelBody.scrollTop;
    panel.hidden = false;
    panel.classList.toggle('is-wide', wide);
    document.body.classList.toggle('has-wide', wide);
    panelBody.replaceChildren(node);
    panelBody.scrollTop = keepScroll ? scroll : 0;
    if (isMobile() && !keepScroll) setSheet(sheetState || (wide ? 'full' : 'half'));
  },
  go(path) { if (location.hash !== `#/${path}`) location.hash = `#/${path}`; else route(); },
  refresh: () => route(),
  isMobile,
  setSheet,
  placeActions,
  addPlaceToTrip,
};

// ---------- Top bar & nav ----------
function buildChrome() {
  const searchInput = h('input', { class: 'search-input', type: 'search', placeholder: 'Search a place or a trip…', 'aria-label': 'Search a place or a trip', autocomplete: 'off' });
  const results = h('div', { class: 'search-results', role: 'listbox', hidden: true });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); runSearch(true); } },
    icon('search', 16), searchInput, results);

  let trips = [];
  const runSearch = async (places) => {
    const q = searchInput.value.trim();
    if (!q) { results.hidden = true; return; }
    const lower = q.toLowerCase();
    if (!trips.length) trips = (await attempt(loadTrips)) || [];
    const tripHits = trips.filter((t) => t.title.toLowerCase().includes(lower)).slice(0, 4);
    const rows = tripHits.map((t) => h('button', { type: 'button', class: 'search-row', role: 'option',
      onclick: () => { results.hidden = true; searchInput.value = ''; app.go(`trip/${t.id}`); } },
      h('span', { class: `dot dot-${tripStatus(t)}` }), h('span', { class: 'search-row-main' }, t.title), h('span', { class: 'search-row-sub' }, fmtRange(t.start_date, t.end_date))));
    results.replaceChildren(...rows, places ? h('p', { class: 'search-note' }, 'Searching places…') : h('p', { class: 'search-note' }, 'Press Enter to search places'));
    results.hidden = false;
    if (!places) return;
    try {
      const hits = await searchPlaces(q);
      const placeRows = hits.map((p) => h('button', { type: 'button', class: 'search-row', role: 'option',
        onclick: async () => { results.hidden = true; await flyTo(p, 12); placeActions(p); } },
        icon('pin', 16), h('span', { class: 'search-row-main' }, p.name), h('span', { class: 'search-row-sub' }, p.place)));
      results.replaceChildren(...rows, ...(placeRows.length ? placeRows : [h('p', { class: 'search-note' }, 'No places found. Try adding the town or country.')]));
    } catch {
      results.replaceChildren(...rows, h('p', { class: 'search-note' }, "Place search isn't answering. Try again in a moment."));
    }
  };
  searchInput.addEventListener('input', debounce(() => runSearch(false), 150));
  searchInput.addEventListener('focus', () => { trips = []; });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) results.hidden = true; });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; searchInput.blur(); } });

  const navItem = (path, label, ic) => h('a', { class: 'nav-link', href: `#/${path}`, dataset: { nav: path } }, icon(ic, 18), h('span', {}, label));
  const accountBtn = h('button', { class: 'avatar', type: 'button', 'aria-label': 'Account', onclick: () => openAccount(app) }, initials(app.me.display_name));

  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/trips', 'aria-label': "Vicki's Travel Planner, all trips" },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, brandMark()),
      h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'Vicki’s'), h('span', { class: 'brand-sub' }, 'Travel Planner'))),
    form,
    h('nav', { class: 'nav', 'aria-label': 'Main' }, navItem('trips', 'Trips', 'globe'), navItem('wishlist', 'Wishlist', 'star'), navItem('photos', 'Photos', 'photo')),
    accountBtn);
  document.body.prepend(top);

  // Map controls
  const styleBtns = ['painted', 'satellite'].map((m) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(mapMode() === m), onclick: () => setMapMode(m) }, m === 'painted' ? 'Map' : 'Satellite'));
  document.addEventListener('mapmode', (e) => styleBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['painted', 'satellite'][i] === e.detail))));
  const map = getMap();
  const controls = h('div', { class: 'map-controls' },
    h('div', { class: 'seg seg-map', role: 'group', 'aria-label': 'Map style' }, styleBtns),
    h('div', { class: 'zoom' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom in', onclick: () => map.zoomIn() }, icon('plus')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom out', onclick: () => map.zoomOut() }, h('span', { class: 'minus', 'aria-hidden': 'true' })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Show the whole world', onclick: () => worldView() }, icon('globe'))));
  document.body.append(controls);

  if (db.demo) document.body.append(h('div', { class: 'demo-flag', role: 'note' }, 'Demo · saved in this browser only'));
}

// ---------- A place card on the map (from search or right-click) ----------
let popup;
async function placeActions(place) {
  popup?.remove();
  const p = { ...place };
  if (!p.name) Object.assign(p, await reversePlace(p));
  if (!p.name) p.name = 'Dropped pin';
  const body = h('div', { class: 'place-pop' },
    h('p', { class: 'place-pop-name' }, p.name),
    p.place ? h('p', { class: 'place-pop-sub' }, p.place) : null,
    h('div', { class: 'place-pop-actions' },
      h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { popup.remove(); addPlaceToTrip(p); } }, 'Add to a trip'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
        popup.remove();
        const row = await attempt(() => db.insert('wishlist', { name: p.name, place: p.place || '', lat: p.lat, lng: p.lng }), 'Added to your wishlist');
        if (row) app.go('wishlist');
      } }, 'Add to wishlist')));
  popup = new window.maplibregl.Popup({ offset: 14, maxWidth: '280px', className: 'vtp-popup' })
    .setLngLat([p.lng, p.lat]).setDOMContent(body).addTo(getMap());
}

export async function addPlaceToTrip(p) {
  const trips = ((await attempt(loadTrips)) || []).filter((t) => t.role === 'owner' && tripStatus(t) !== 'past');
  if (!trips.length) { toast('Make a trip first, then add places to it.', 'error'); app.go('trips'); return; }
  const tripSel = select(Object.fromEntries(trips.map((t) => [t.id, t.title])), trips[0].id);
  const daySel = h('select', { class: 'input' });
  const fillDays = () => {
    const t = trips.find((x) => x.id === tripSel.value);
    const n = Math.max(tripDays(t), 1);
    daySel.replaceChildren(h('option', { value: 0 }, 'Not scheduled yet'), ...Array.from({ length: n }, (_, i) => h('option', { value: i + 1 }, dayLabel(t, i + 1))));
  };
  tripSel.addEventListener('change', fillDays); fillDays();
  const kind = select(KINDS, 'sight');
  openDialog({
    title: `Add “${p.name}” to a trip`,
    body: h('div', { class: 'form' }, field('Trip', tripSel), field('Day', daySel), field('Type', kind)),
    actions: [
      { label: 'Cancel' },
      { label: 'Add stop', kind: 'primary', onClick: async () => {
        const day = +daySel.value;
        const existing = await db.list('stops', { trip_id: tripSel.value, day });
        const row = await attempt(() => db.insert('stops', { trip_id: tripSel.value, day, position: existing.length, name: p.name, place: p.place || '', lat: p.lat, lng: p.lng, kind: kind.value }), 'Stop added');
        if (row) { if (p.wishlistId) await attempt(() => db.remove('wishlist', p.wishlistId)); app.go(`trip/${tripSel.value}`); }
      } },
    ],
  });
}

// ---------- Router ----------
let routeToken = 0;
async function route() {
  const token = ++routeToken;
  popup?.remove();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [name = 'trips', id, sub, subId] = parts;
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.nav === name || (name === 'trip' && a.dataset.nav === 'trips')));
  const stale = () => token !== routeToken;
  try {
    if (name === 'trip' && id) await renderTrip(app, id, sub, subId, stale);
    else if (name === 'wishlist') await renderWishlist(app, stale, id);
    else if (name === 'photos') await renderPhotos(app, stale);
    else if (name === 'play' && id) await playTrip(app, id);
    else await renderTrips(app, id === 'past' ? 'past' : 'upcoming', stale);
  } catch (e) {
    if (!db.me) return;   // signed out mid-way (session ended): the sign-in page is on its way
    console.error(e);
    app.show(h('div', { class: 'view' }, h('p', { class: 'eyebrow' }, 'Something went wrong'), h('h1', { class: 'view-title' }, 'This page didn’t load'), h('p', { class: 'muted' }, e.message || ''), h('a', { class: 'btn', href: '#/trips' }, 'Back to all trips')));
  }
}

// ---------- Start ----------
async function boot() {
  initMap($('#map'));
  db.onAuthChange((event) => {
    if (event === 'signed-out') { toast('Please sign in again.', 'error'); setTimeout(() => location.reload(), 1200); }
  });
  const me = await db.session().catch(() => null);
  if (!me) {
    document.body.classList.add('signed-out');
    panel.hidden = true;
    renderAuth(db, () => location.reload());
    return;
  }
  app.me = me;
  document.body.classList.add('signed-in');
  buildChrome();
  onMapContext((p) => placeActions(p));
  mobileQuery.addEventListener('change', () => setTimeout(resize, 50));
  window.addEventListener('hashchange', route);
  route();
}

boot();

// Exposed for the browser console while testing (?debug).
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __vtp: { app, db, setPins, setRoute } });
