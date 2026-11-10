// One trip: header, tabs (itinerary, photos, bookings, budget, packing, people) and a stop's page.
import { db, loadTrips, photoUrls } from '../db.js?v=2';
import {
  h, icon, attempt, toast, openDialog, confirmDialog, field, input, textarea, select, emptyState,
  tripStatus, countdown, fmtRange, tripDays, dayLabel, dayColour, KINDS,
} from '../ui.js?v=2';
import { setPins, setRoute, fitTo, flyTo, pickPoint } from '../map.js?v=2';
import { searchPlaces, reversePlace, parseCoords, isShortGoogleLink } from '../places.js?v=2';
import { tripForm } from './trips.js?v=2';
import { renderBookings, renderBudget, renderPacking, renderPeople } from './trip-tabs.js?v=2';
import { openUploader } from '../upload.js?v=2';
import { openLightbox, photoGrid } from './photos.js?v=2';

const TABS = { itinerary: 'Itinerary', photos: 'Photos', bookings: 'Bookings', budget: 'Budget', packing: 'Packing', people: 'People' };
let lastKey = '';

// Stops in trip order, with their running number (unscheduled stops have none).
export function orderStops(stops) {
  const sorted = stops.slice().sort((a, b) => (a.day || 999) - (b.day || 999) || a.position - b.position || (a.start_time || '').localeCompare(b.start_time || ''));
  let n = 0;
  return sorted.map((s) => ({ ...s, num: s.day ? ++n : null }));
}

export function drawTripMap(app, trip, stops, activeId = null) {
  setPins(stops.map((s) => ({
    lat: s.lat, lng: s.lng, variant: 'stop', label: s.num ? String(s.num) : '·', colour: dayColour(s.day),
    title: `${s.num ? s.num + '. ' : ''}${s.name}`, active: s.id === activeId,
    onClick: () => app.go(`trip/${trip.id}/stop/${s.id}`),
  })));
  const days = [...new Set(stops.filter((s) => s.day).map((s) => s.day))].sort((a, b) => a - b);
  const segs = [];
  let prevLast = null;
  for (const d of days) {
    const ds = stops.filter((s) => s.day === d);
    if (prevLast) segs.push({ coords: [[prevLast.lng, prevLast.lat], [ds[0].lng, ds[0].lat]], colour: dayColour(d), between: true });
    segs.push({ coords: ds.map((s) => [s.lng, s.lat]), colour: dayColour(d) });
    prevLast = ds[ds.length - 1];
  }
  setRoute(segs);
}

export async function renderTrip(app, id, sub, subId, stale) {
  const trips = await loadTrips();
  const trip = trips.find((t) => t.id === id);
  if (stale()) return;
  if (!trip) {
    app.show(h('div', { class: 'view' }, h('h1', { class: 'view-title' }, 'Trip not found'),
      h('p', { class: 'muted' }, 'It may have been deleted, or you haven’t been invited to it.'), h('a', { class: 'btn', href: '#/trips' }, 'Back to all trips')));
    return;
  }
  const [rawStops, photos, profiles] = await Promise.all([
    db.list('stops', { trip_id: id }, [['day', true], ['position', true]]),
    db.list('photos', { trip_id: id }, [['taken_at', true], ['created_at', true]]),
    db.listProfiles(),
  ]);
  if (stale()) return;
  const stops = orderStops(rawStops);
  const ctx = { app, trip, stops, photos, profiles, isOwner: trip.role === 'owner', me: app.me, rerender: () => app.refresh() };

  const key = `${id}/${sub || ''}/${subId || ''}`;
  const keepScroll = key === lastKey;
  lastKey = key;

  if (sub === 'stop' && subId) return renderStop(ctx, subId, keepScroll);

  const tab = TABS[sub] ? sub : 'itinerary';
  const allowed = Object.keys(TABS).filter((k) => (k !== 'budget' || trip.canSeeBudget) && (k !== 'people' || ctx.isOwner));
  const content = h('div', { class: 'tab-panel', role: 'tabpanel' });

  app.show(h('div', { class: 'view' },
    tripHeader(ctx),
    h('nav', { class: 'tabs', 'aria-label': 'Trip sections' },
      allowed.map((k) => h('a', { class: 'tab', href: `#/trip/${id}/${k}`, 'aria-current': k === tab ? 'page' : null }, TABS[k]))),
    content), { keepScroll });

  drawTripMap(app, trip, stops);
  if (!keepScroll) {
    if (stops.length) fitTo(stops, { maxZoom: 13 });
  }

  if (tab === 'itinerary') await renderItinerary(ctx, content);
  else if (tab === 'photos') await renderTripPhotos(ctx, content);
  else if (tab === 'bookings') await renderBookings(ctx, content);
  else if (tab === 'budget' && trip.canSeeBudget) await renderBudget(ctx, content);
  else if (tab === 'packing') await renderPacking(ctx, content);
  else if (tab === 'people' && ctx.isOwner) await renderPeople(ctx, content);
}

function tripHeader(ctx) {
  const { trip, app, isOwner, profiles, photos } = ctx;
  const owner = profiles.find((p) => p.id === trip.owner_id)?.display_name || 'someone';
  const st = tripStatus(trip);
  const more = [];
  if (isOwner) {
    more.push(h('button', { class: 'btn btn-small', type: 'button', onclick: () => editTrip(ctx) }, icon('edit', 15), 'Edit'));
    more.push(h('button', { class: 'btn btn-small btn-quiet danger-text', type: 'button', onclick: () => deleteTrip(ctx) }, icon('trash', 15), 'Delete trip'));
  } else {
    more.push(h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: async () => {
      if (!(await confirmDialog('Leave this trip?', `You won’t see “${trip.title}” any more unless ${owner} invites you again.`, 'Leave trip'))) return;
      if (await attempt(() => db.removeMember(trip.id, app.me.id), 'You left the trip') !== undefined) app.go('trips');
    } }, 'Leave trip'));
  }
  return h('header', { class: 'trip-head' },
    h('a', { class: 'back', href: st === 'past' ? '#/trips/past' : '#/trips' }, icon('back', 16), 'All trips'),
    h('div', { class: 'trip-head-row' },
      h('span', { class: `stamp stamp-${st}` }, countdown(trip)),
      !isOwner ? h('span', { class: 'by' }, `Planned by ${owner} · view only`) : null),
    h('h1', { class: 'view-title' }, trip.title),
    h('p', { class: 'trip-dates' }, fmtRange(trip.start_date, trip.end_date), trip.start_date && trip.end_date ? ` · ${tripDays(trip)} days` : ''),
    trip.summary ? h('p', { class: 'trip-summary' }, trip.summary) : null,
    h('div', { class: 'trip-actions' },
      ctx.stops.some((s) => s.day) ? h('a', { class: 'btn btn-small btn-primary', href: `#/play/${trip.id}` }, icon('play', 15), 'Play the trip') : null,
      more,
      photos.length ? h('span', { class: 'muted small' }, `${photos.length} photos`) : null));
}

function editTrip(ctx) {
  const f = tripForm(ctx.trip);
  openDialog({
    title: 'Edit trip',
    body: f.node,
    actions: [{ label: 'Cancel' }, { label: 'Save changes', kind: 'primary', onClick: async () => {
      const data = f.read();
      if (!data) return false;
      if (await attempt(() => db.update('trips', ctx.trip.id, data), 'Changes saved')) ctx.rerender();
    } }],
  });
}

async function deleteTrip(ctx) {
  const { trip, photos, app } = ctx;
  const ok = await confirmDialog('Delete this trip?',
    `“${trip.title}” will be deleted with its stops, bookings, budget, packing list and ${photos.length} photos, for everyone it’s shared with. This can’t be undone.`, 'Delete trip');
  if (!ok) return;
  const done = await attempt(async () => {
    await db.deletePhotos(photos);
    await db.remove('trips', trip.id);
  }, 'Trip deleted');
  if (done !== undefined) app.go('trips');
}

// ---------- Itinerary ----------
async function renderItinerary(ctx, root) {
  const { trip, stops, photos, isOwner, app } = ctx;
  const nDays = Math.max(tripDays(trip), ...stops.map((s) => s.day), 1);
  const photoCount = (sid) => photos.filter((p) => p.stop_id === sid).length;

  if (isOwner) root.append(addStopBar(ctx));

  const lists = [];
  const dayBlock = (day) => {
    const ds = stops.filter((s) => s.day === day);
    if (!isOwner && !ds.length) return null;
    const ul = h('ol', { class: 'stop-list', dataset: { day } },
      ds.map((s) => h('li', { class: 'stop', dataset: { id: s.id } },
        isOwner ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'Drag to move' }, icon('grip', 16)) : null,
        h('a', { class: 'stop-link', href: `#/trip/${trip.id}/stop/${s.id}` },
          h('span', { class: 'num', style: `--c:${dayColour(s.day)}` }, s.num || '·'),
          h('span', { class: 'stop-main' },
            h('span', { class: 'stop-name' }, s.name),
            h('span', { class: 'stop-meta' }, [KINDS[s.kind], s.start_time ? s.start_time.slice(0, 5) : '', s.place].filter(Boolean).join(' · '))),
          photoCount(s.id) ? h('span', { class: 'stop-photos', title: `${photoCount(s.id)} photos` }, icon('photo', 14), photoCount(s.id)) : null))));
    lists.push(ul);
    return h('section', { class: `day${day ? '' : ' day-unscheduled'}` },
      h('h2', { class: 'day-title' }, h('span', { class: 'day-swatch', style: `--c:${dayColour(day)}` }), dayLabel(trip, day)),
      ul,
      !ds.length ? h('p', { class: 'day-empty muted' }, isOwner ? (day ? 'Nothing planned yet. Add a place, or drag a stop here.' : 'Places you haven’t given a day yet.') : 'Nothing planned.') : null);
  };

  const days = Array.from({ length: nDays }, (_, i) => dayBlock(i + 1));
  const unscheduled = stops.some((s) => !s.day) || isOwner ? dayBlock(0) : null;
  root.append(h('div', { class: 'days' }, days, unscheduled));

  if (!stops.length) root.append(emptyState('No stops yet', isOwner ? 'Search for a place above, paste a Google Maps link, or pick a spot on the map.' : 'The planner hasn’t added any places yet.'));

  if (isOwner && stops.length) {
    const { default: Sortable } = await import('https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js');
    const save = async () => {
      const changes = [];
      for (const ul of lists) {
        const day = +ul.dataset.day;
        [...ul.children].forEach((li, position) => {
          const s = stops.find((x) => x.id === li.dataset.id);
          if (s && (s.day !== day || s.position !== position)) changes.push({ id: s.id, day, position });
        });
      }
      if (!changes.length) return;
      await attempt(() => Promise.all(changes.map((c) => db.update('stops', c.id, { day: c.day, position: c.position }))));
      ctx.rerender();
    };
    for (const ul of lists) Sortable.create(ul, { group: 'stops', handle: '.grip', animation: 150, ghostClass: 'stop-ghost', emptyInsertThreshold: 24, onEnd: save });
  }
}

function addStopBar(ctx) {
  const q = input({ type: 'search', placeholder: 'Add a place: search, or paste a map link', 'aria-label': 'Add a place to this trip', autocomplete: 'off' });
  const results = h('div', { class: 'add-results' });
  const go = async () => {
    const text = q.value.trim();
    if (!text) return;
    if (isShortGoogleLink(text)) { results.replaceChildren(h('p', { class: 'search-note' }, 'Short Google links can’t be read. Open the link, then copy the long address from the browser bar.')); return; }
    const coords = parseCoords(text);
    if (coords && /^https?:/.test(text)) {
      const r = await reversePlace(coords);
      stopDialog(ctx, null, { ...coords, name: r.name, place: r.place });
      q.value = ''; results.replaceChildren();
      return;
    }
    results.replaceChildren(h('p', { class: 'search-note' }, 'Searching…'));
    try {
      const hits = await searchPlaces(text);
      results.replaceChildren(...(hits.length ? hits.map((p) => h('button', { type: 'button', class: 'search-row', onclick: () => {
        results.replaceChildren(); q.value = '';
        flyTo(p, 13);
        stopDialog(ctx, null, p);
      } }, icon('pin', 16), h('span', { class: 'search-row-main' }, p.name), h('span', { class: 'search-row-sub' }, p.place))) : [h('p', { class: 'search-note' }, 'No places found. Try adding the town or country.')]));
    } catch { results.replaceChildren(h('p', { class: 'search-note' }, 'Place search isn’t answering. Try again in a moment.')); }
  };
  return h('div', { class: 'add-stop' },
    h('form', { class: 'add-stop-row', onsubmit: (e) => { e.preventDefault(); go(); } },
      q,
      h('button', { class: 'btn', type: 'submit' }, 'Search'),
      h('button', { class: 'btn btn-quiet', type: 'button', title: 'Pick a spot on the map', onclick: async () => {
        if (ctx.app.isMobile()) ctx.app.setSheet('peek');
        const p = await pickPoint('Tap the map where this stop is');
        if (ctx.app.isMobile()) ctx.app.setSheet('half');
        if (!p) return;
        const r = await reversePlace(p);
        stopDialog(ctx, null, { ...p, ...r });
      } }, icon('pin', 16), h('span', { class: 'hide-sm' }, 'Pick on map'))),
    results);
}

export function stopDialog(ctx, stop, preset = {}) {
  const { trip, stops, app } = ctx;
  const s = stop || { name: preset.name || '', place: preset.place || '', lat: preset.lat, lng: preset.lng, kind: 'sight', day: 0, start_time: null, notes: '', links: [] };
  const nDays = Math.max(tripDays(trip), ...stops.map((x) => x.day), 1);
  const name = input({ value: s.name, required: true, maxlength: 160 });
  const kind = select(KINDS, s.kind);
  const day = select(Object.fromEntries([[0, 'Not scheduled yet'], ...Array.from({ length: nDays }, (_, i) => [i + 1, dayLabel(trip, i + 1)])]), String(s.day || 0));
  const time = input({ type: 'time', value: s.start_time ? s.start_time.slice(0, 5) : '' });
  const place = input({ value: s.place || '', maxlength: 300, placeholder: 'Address or area' });
  const notes = textarea({ maxlength: 5000, placeholder: 'Opening times, tips, what to order…' });
  notes.value = s.notes || '';
  const links = textarea({ rows: 2, placeholder: 'One link per line' });
  links.value = (s.links || []).join('\n');
  let pos = { lat: s.lat, lng: s.lng };
  const posText = h('span', { class: 'mono small' }, `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`);
  let dlgRef;
  const moveBtn = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: async () => {
    dlgRef.dlg.close();
    const p = await pickPoint('Click the exact spot for this stop');
    if (p) pos = p;
    stopDialog(ctx, stop ? { ...stop, ...pos, name: name.value, kind: kind.value, day: +day.value, start_time: time.value || null, place: place.value, notes: notes.value, links: links.value.split('\n') } : null,
      { ...preset, ...pos, name: name.value, place: place.value });
  } }, icon('pin', 14), 'Move on map');

  dlgRef = openDialog({
    title: stop ? 'Edit stop' : 'Add stop',
    body: h('div', { class: 'form' },
      field('Name', name),
      h('div', { class: 'form-row' }, field('Type', kind), field('Time (optional)', time)),
      field('Day', day),
      field('Address or area', place),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Location'), h('div', { class: 'loc-row' }, posText, moveBtn)),
      field('Notes', notes),
      field('Links', links)),
    actions: [
      { label: 'Cancel' },
      { label: stop ? 'Save changes' : 'Add stop', kind: 'primary', onClick: async () => {
        if (!name.value.trim()) { toast('Give the stop a name.', 'error'); return false; }
        const d = +day.value;
        const data = {
          name: name.value.trim(), kind: kind.value, day: d, start_time: time.value || null,
          place: place.value.trim(), notes: notes.value.trim(), lat: pos.lat, lng: pos.lng,
          links: links.value.split('\n').map((x) => x.trim()).filter(Boolean),
        };
        if (!stop || stop.day !== d) data.position = stops.filter((x) => x.day === d && x.id !== stop?.id).length;
        const row = await attempt(() => (stop ? db.update('stops', stop.id, data) : db.insert('stops', { ...data, trip_id: trip.id })), stop ? 'Changes saved' : 'Stop added');
        if (!row) return false;
        app.refresh();
      } },
    ],
  });
}

// ---------- A stop's page ----------
async function renderStop(ctx, stopId, keepScroll) {
  const { trip, stops, photos, isOwner, app } = ctx;
  const s = stops.find((x) => x.id === stopId);
  if (!s) { app.go(`trip/${trip.id}`); return; }
  const mine = photos.filter((p) => p.stop_id === s.id);
  const bookings = await db.list('bookings', { trip_id: trip.id, stop_id: s.id }, [['starts_at', true]]);
  const url = await photoUrls(mine);
  const i = stops.indexOf(s);
  const prev = stops[i - 1], next = stops[i + 1];

  const view = h('div', { class: 'view' },
    h('a', { class: 'back', href: `#/trip/${trip.id}` }, icon('back', 16), trip.title),
    h('p', { class: 'eyebrow' }, h('span', { class: 'num', style: `--c:${dayColour(s.day)}` }, s.num || '·'), ' ', KINDS[s.kind], ' · ', dayLabel(trip, s.day), s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''),
    h('h1', { class: 'view-title' }, s.name),
    s.place ? h('p', { class: 'muted' }, s.place) : null,
    isOwner ? h('div', { class: 'trip-actions' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => stopDialog(ctx, s) }, icon('edit', 15), 'Edit'),
      h('button', { class: 'btn btn-small btn-quiet danger-text', type: 'button', onclick: async () => {
        if (!(await confirmDialog('Delete this stop?', `“${s.name}” will be removed from the trip. Its ${mine.length} photos stay in the trip as unsorted photos.`, 'Delete stop'))) return;
        if (await attempt(() => db.remove('stops', s.id), 'Stop deleted') !== undefined) app.go(`trip/${trip.id}`);
      } }, icon('trash', 15), 'Delete')) : null,
    s.notes ? h('p', { class: 'notes' }, s.notes) : null,
    s.links?.length ? h('ul', { class: 'links' }, s.links.map((l) => h('li', {}, h('a', { href: /^https?:\/\//.test(l) ? l : `https://${l}`, target: '_blank', rel: 'noopener' }, icon('link', 14), l.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))))) : null,
    h('a', { class: 'small', href: `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`, target: '_blank', rel: 'noopener' }, 'Open in Google Maps'),
    bookings.length ? h('section', { class: 'section' }, h('h2', { class: 'section-title' }, 'Bookings'),
      h('ul', { class: 'mini-list' }, bookings.map((b) => h('li', {}, h('strong', {}, b.title), b.reference ? h('span', { class: 'mono small' }, ` · ${b.reference}`) : null)))) : null,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title' }, 'Photos', mine.length ? h('span', { class: 'count' }, mine.length) : null),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => openUploader(ctx, { stopId: s.id }) }, icon('upload', 15), 'Add photos')),
      mine.length ? photoGrid(mine, url, (idx) => openLightbox(mine, idx, { url, ctx }))
        : h('p', { class: 'muted small' }, 'No photos here yet.')),
    h('nav', { class: 'stop-nav', 'aria-label': 'Other stops' },
      prev ? h('a', { class: 'btn btn-quiet btn-small', href: `#/trip/${trip.id}/stop/${prev.id}` }, icon('back', 14), prev.name) : h('span'),
      next ? h('a', { class: 'btn btn-quiet btn-small', href: `#/trip/${trip.id}/stop/${next.id}` }, next.name, h('span', { class: 'flip' }, icon('back', 14))) : null));

  app.show(view, { keepScroll });
  drawTripMap(app, trip, stops, s.id);
  if (!keepScroll) flyTo(s, Math.max(13, 0), 1400);
}

// ---------- Photos tab ----------
async function renderTripPhotos(ctx, root) {
  const { trip, stops, photos } = ctx;
  const url = await photoUrls(photos);
  const st = tripStatus(trip);
  root.append(h('div', { class: st === 'upcoming' ? 'section-head' : 'callout' },
    st !== 'upcoming' ? h('div', {},
      h('p', { class: 'callout-title' }, st === 'now' ? 'Taking photos?' : `Back from ${trip.title}?`),
      h('p', { class: 'muted small' }, 'Add everyone’s photos in one go. Each one is placed on the stop where it was taken, using its time and location. You can move any before saving.')) : h('p', { class: 'muted small' }, 'Photos go here once you’re on the trip.'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openUploader(ctx, {}) }, icon('upload', 16), 'Add trip photos')));

  if (!photos.length) { root.append(emptyState('No photos yet', null)); return; }
  const groups = [...stops.map((s) => ({ title: s.name, sub: dayLabel(trip, s.day), num: s.num, day: s.day, items: photos.filter((p) => p.stop_id === s.id) })),
    { title: 'Not matched to a stop', items: photos.filter((p) => !p.stop_id || !stops.some((s) => s.id === p.stop_id)) }]
    .filter((g) => g.items.length);
  const ordered = groups.flatMap((g) => g.items);
  for (const g of groups) {
    root.append(h('section', { class: 'section' },
      h('h3', { class: 'group-title' }, g.num ? h('span', { class: 'num', style: `--c:${dayColour(g.day)}` }, g.num) : null, g.title, g.sub ? h('span', { class: 'muted small' }, ` · ${g.sub}`) : null),
      photoGrid(g.items, url, (idx) => openLightbox(ordered, ordered.indexOf(g.items[idx]), { url, ctx }))));
  }
}
