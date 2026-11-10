// Home: every trip you can see, upcoming or past, with all their stops on the map.
import { db, loadTrips, photoUrls } from '../db.js?v=1';
import { h, icon, openDialog, field, input, textarea, attempt, toast, tripStatus, countdown, fmtRange, emptyState, initials } from '../ui.js?v=1';
import { setPins, setRoute, fitTo, worldView } from '../map.js?v=1';

const CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR', 'CHF', 'JPY', 'AUD', 'CAD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'THB', 'SGD', 'HKD', 'CNY', 'INR', 'IDR', 'MXN', 'BRL', 'KRW', 'ISK', 'RON', 'BGN', 'ILS', 'MYR', 'PHP'];
export const currencySelect = (value = 'EUR') => {
  const s = h('select', { class: 'input' }, CURRENCIES.map((c) => h('option', { value: c }, c)));
  s.value = value;
  return s;
};

export function tripForm(t = {}) {
  const title = input({ value: t.title || '', required: true, maxlength: 120, placeholder: 'e.g. Japan in spring' });
  const start = input({ type: 'date', value: t.start_date || '' });
  const end = input({ type: 'date', value: t.end_date || '' });
  const summary = textarea({ maxlength: 2000, placeholder: 'What’s the plan? (optional)' });
  summary.value = t.summary || '';
  const currency = currencySelect(t.currency || 'EUR');
  start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; end.min = start.value; });
  const node = h('div', { class: 'form' },
    field('Trip name', title),
    h('div', { class: 'form-row' }, field('First day', start), field('Last day', end)),
    field('About this trip', summary),
    field('Budget currency', currency, 'Costs in other currencies are converted to this one.'));
  const read = () => {
    if (!title.value.trim()) { toast('Give the trip a name.', 'error'); return null; }
    if (start.value && end.value && end.value < start.value) { toast('The last day is before the first day.', 'error'); return null; }
    return { title: title.value.trim(), start_date: start.value || null, end_date: end.value || start.value || null, summary: summary.value.trim(), currency: currency.value };
  };
  return { node, read };
}

export function newTrip(app) {
  const f = tripForm();
  openDialog({
    title: 'New trip',
    body: f.node,
    actions: [
      { label: 'Cancel' },
      { label: 'Create trip', kind: 'primary', onClick: async () => {
        const data = f.read();
        if (!data) return false;
        const row = await attempt(() => db.insert('trips', data), 'Trip created');
        if (!row) return false;
        app.go(`trip/${row.id}`);
      } },
    ],
  });
}

export async function renderTrips(app, tab, stale) {
  const trips = await loadTrips();
  if (stale()) return;
  const ids = trips.map((t) => t.id);
  const [stops, wishlist, photos, profiles] = await Promise.all([
    db.list('stops', { trip_id: ids }, [['day', true], ['position', true]]),
    db.list('wishlist', {}),
    db.list('photos', { trip_id: ids }, [['taken_at', true]]),
    db.listProfiles(),
  ]);
  if (stale()) return;
  const nameOf = (id) => profiles.find((p) => p.id === id)?.display_name || 'someone';
  const coverOf = (t) => photos.find((p) => p.id === t.cover_photo_id) || photos.find((p) => p.trip_id === t.id);
  const url = await photoUrls(trips.map(coverOf).filter(Boolean));

  const upcoming = trips.filter((t) => tripStatus(t) !== 'past')
    .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
  const past = trips.filter((t) => tripStatus(t) === 'past')
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

  function card(t) {
    const tStops = stops.filter((s) => s.trip_id === t.id);
    const tPhotos = photos.filter((p) => p.trip_id === t.id);
    const cover = coverOf(t);
    const st = tripStatus(t);
    return h('a', { class: `trip-card trip-${st}`, href: `#/trip/${t.id}` },
      h('div', { class: 'trip-cover' },
        cover && url(cover) ? h('img', { src: url(cover), alt: '', loading: 'lazy' }) : h('span', { class: 'trip-cover-initials', 'aria-hidden': 'true' }, initials(t.title)),
        h('span', { class: 'stamp' }, countdown(t))),
      h('div', { class: 'trip-card-body' },
        h('h3', { class: 'trip-card-title' }, t.title),
        h('p', { class: 'trip-card-dates' }, fmtRange(t.start_date, t.end_date)),
        h('p', { class: 'trip-card-meta' },
          `${tStops.length} ${tStops.length === 1 ? 'stop' : 'stops'}`,
          tPhotos.length ? ` · ${tPhotos.length} ${tPhotos.length === 1 ? 'photo' : 'photos'}` : '',
          t.role === 'viewer' ? ` · from ${nameOf(t.owner_id)}` : t.members.length ? ` · shared with ${t.members.length}` : '')));
  }

  const list = tab === 'past' ? past : upcoming;
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Which trips' },
    h('a', { class: 'seg-btn', role: 'tab', href: '#/trips', 'aria-selected': String(tab !== 'past') }, `Upcoming`, h('span', { class: 'count' }, upcoming.length)),
    h('a', { class: 'seg-btn', role: 'tab', href: '#/trips/past', 'aria-selected': String(tab === 'past') }, `Past`, h('span', { class: 'count' }, past.length)));

  let content;
  if (list.length) content = h('div', { class: 'trip-list' }, list.map(card));
  else if (tab === 'past') content = emptyState('No past trips yet', 'When a trip’s last day has gone by, it moves here with its photos.');
  else content = emptyState('Where to next?', 'Make a trip, then add the places you want to go, day by day.',
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newTrip(app) }, icon('plus', 16), 'New trip'));

  app.show(h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `Hello, ${app.me.display_name.split(' ')[0]}`), h('h1', { class: 'view-title' }, 'Your trips')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newTrip(app) }, icon('plus', 16), 'New trip')),
    tabs,
    content,
    h('ul', { class: 'legend', 'aria-label': 'Map key' },
      h('li', {}, h('span', { class: 'dot dot-upcoming' }), 'Upcoming'),
      h('li', {}, h('span', { class: 'dot dot-past' }), 'Visited'),
      h('li', {}, h('span', { class: 'dot dot-wishlist' }), 'Wishlist')),
  ));

  // Map: every stop of every trip, plus wishlist pins.
  const pins = [];
  for (const s of stops) {
    const t = trips.find((x) => x.id === s.trip_id);
    const st = tripStatus(t);
    pins.push({ lat: s.lat, lng: s.lng, variant: st === 'past' ? 'past' : 'upcoming', title: `${s.name} · ${t.title}`, onClick: () => app.go(`trip/${t.id}/stop/${s.id}`) });
  }
  for (const w of wishlist) pins.push({ lat: w.lat, lng: w.lng, variant: 'wishlist', title: `${w.name} · Wishlist`, onClick: () => app.go(`wishlist/${w.id}`) });
  setPins(pins);
  setRoute([]);
  const focus = stops.filter((s) => list.some((t) => t.id === s.trip_id));
  if (focus.length) fitTo(focus, { maxZoom: 5 }); else worldView();
}
