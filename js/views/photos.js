// Photo grid, the lightbox, and the page with every photo from every trip.
import { db, loadTrips, photoUrls } from '../db.js?v=1';
import { h, icon, attempt, confirmDialog, emptyState, fmtRange, fmtDate, tripStatus } from '../ui.js?v=1';
import { setPins, setRoute, fitTo } from '../map.js?v=1';

export function photoGrid(list, url, onOpen) {
  return h('ul', { class: 'photo-grid' }, list.map((p, i) => h('li', {},
    h('button', { class: 'photo-tile', type: 'button', 'aria-label': `Open photo ${i + 1}${p.caption ? ': ' + p.caption : ''}`, onclick: () => onOpen(i) },
      h('img', { src: url(p), alt: p.caption || '', loading: 'lazy', width: 240, height: 240 })))));
}

export function openLightbox(list, start, opts) {
  const ctx = opts.ctx;
  const tripOf = opts.tripOf || (() => ctx.trip);
  const stopOf = opts.stopOf || ((p) => ctx.stops.find((s) => s.id === p.stop_id));
  const me = opts.me || ctx.me;
  const nameOf = opts.nameOf || ((id) => ctx.profiles.find((x) => x.id === id)?.display_name || '');
  const onChanged = opts.onChanged || (() => ctx.rerender());
  const url = opts.url;
  let i = start;
  let changed = false;

  const img = h('img', { class: 'lb-img', alt: '' });
  const caption = h('div', { class: 'lb-caption' });
  const counter = h('span', { class: 'lb-count mono small' });
  const dlg = h('dialog', { class: 'lightbox', 'aria-label': 'Photo viewer' });
  const prevBtn = h('button', { class: 'lb-nav lb-prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => go(-1) }, icon('back', 22));
  const nextBtn = h('button', { class: 'lb-nav lb-next', type: 'button', 'aria-label': 'Next photo', onclick: () => go(1) }, h('span', { class: 'flip' }, icon('back', 22)));

  function draw() {
    const p = list[i];
    const trip = tripOf(p);
    const stop = stopOf(p);
    img.src = url(p, 'thumb');
    const full = url(p, 'full');
    if (full) { const pre = new Image(); pre.onload = () => { if (list[i] === p) img.src = full; }; pre.src = full; }
    img.alt = p.caption || (stop ? `Photo at ${stop.name}` : 'Trip photo');
    counter.textContent = `${i + 1} / ${list.length}`;
    prevBtn.hidden = i === 0; nextBtn.hidden = i === list.length - 1;
    const isTripOwner = trip.owner_id === me.id;
    const canDelete = p.uploaded_by === me.id || isTripOwner;
    caption.replaceChildren(
      h('div', {},
        h('p', { class: 'lb-title' }, stop ? stop.name : 'Not matched to a stop'),
        h('p', { class: 'lb-sub' }, trip.title,
          p.taken_at ? ` · ${fmtDate(p.taken_at.slice(0, 10))} ${p.taken_at.slice(11, 16)}` : '',
          p.uploaded_by !== me.id ? ` · added by ${nameOf(p.uploaded_by)}` : '')),
      h('div', { class: 'lb-actions' },
        stop ? h('a', { class: 'btn btn-small btn-ghost', href: `#/trip/${trip.id}/stop/${stop.id}`, onclick: () => dlg.close() }, icon('pin', 14), 'Show stop') : null,
        isTripOwner ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'aria-pressed': String(trip.cover_photo_id === p.id), onclick: async () => {
          if (await attempt(() => db.update('trips', trip.id, { cover_photo_id: p.id }), 'Trip cover set')) { trip.cover_photo_id = p.id; changed = true; draw(); }
        } }, icon('star', 14), trip.cover_photo_id === p.id ? 'Trip cover' : 'Make trip cover') : null,
        canDelete ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Delete this photo?', 'It will be removed for everyone on this trip. This can’t be undone.', 'Delete photo'))) return;
          if (await attempt(() => db.deletePhotos([p]), 'Photo deleted')) {
            changed = true;
            list.splice(i, 1);
            if (!list.length) { dlg.close(); return; }
            i = Math.min(i, list.length - 1);
            draw();
          }
        } }, icon('trash', 14), 'Delete') : null));
  }
  const go = (d) => { const n = i + d; if (n >= 0 && n < list.length) { i = n; draw(); } };

  dlg.append(
    h('button', { class: 'lb-close icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close', 22)),
    counter, h('div', { class: 'lb-stage' }, img), prevBtn, nextBtn, caption);
  dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); });
  let x0 = null;
  dlg.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; });
  dlg.addEventListener('close', () => { dlg.remove(); if (changed) onChanged(); });
  document.body.append(dlg);
  dlg.showModal();
  draw();
}

// ---------- All photos ----------
export async function renderPhotos(app, stale) {
  const trips = await loadTrips();
  const ids = trips.map((t) => t.id);
  const [photos, stops, profiles] = await Promise.all([
    db.list('photos', { trip_id: ids }, [['taken_at', true], ['created_at', true]]),
    db.list('stops', { trip_id: ids }),
    db.listProfiles(),
  ]);
  if (stale()) return;
  const url = await photoUrls(photos);
  const years = [...new Set(trips.filter((t) => t.start_date && photos.some((p) => p.trip_id === t.id)).map((t) => t.start_date.slice(0, 4)))].sort().reverse();
  const tripSel = h('select', { class: 'input', 'aria-label': 'Trip' }, h('option', { value: '' }, 'All trips'),
    trips.filter((t) => photos.some((p) => p.trip_id === t.id)).map((t) => h('option', { value: t.id }, t.title)));
  const yearSel = h('select', { class: 'input', 'aria-label': 'Year' }, h('option', { value: '' }, 'Every year'), years.map((y) => h('option', { value: y }, y)));
  const body = h('div');

  const opts = {
    url, me: app.me,
    tripOf: (p) => trips.find((t) => t.id === p.trip_id),
    stopOf: (p) => stops.find((s) => s.id === p.stop_id),
    nameOf: (id) => profiles.find((x) => x.id === id)?.display_name || '',
    onChanged: () => app.refresh(),
  };

  function draw() {
    const shown = trips
      .filter((t) => (!tripSel.value || t.id === tripSel.value) && (!yearSel.value || (t.start_date || '').startsWith(yearSel.value)))
      .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
      .map((t) => ({ t, items: photos.filter((p) => p.trip_id === t.id) }))
      .filter((g) => g.items.length);
    if (!shown.length) {
      body.replaceChildren(emptyState('No photos yet', 'Open a trip and choose Add trip photos. Everyone on the trip can add theirs.'));
    } else {
      body.replaceChildren(...shown.map(({ t, items }) => h('section', { class: 'section' },
        h('div', { class: 'section-head' },
          h('h2', { class: 'section-title' }, h('a', { href: `#/trip/${t.id}/photos` }, t.title), h('span', { class: 'count' }, items.length)),
          h('span', { class: 'muted small' }, fmtRange(t.start_date, t.end_date), tripStatus(t) === 'past' ? '' : ' · upcoming')),
        photoGrid(items, url, (idx) => openLightbox(items, idx, opts)))));
    }
    const withPhotos = stops.filter((s) => photos.some((p) => p.stop_id === s.id) && (!tripSel.value || s.trip_id === tripSel.value));
    setPins(withPhotos.map((s) => ({ lat: s.lat, lng: s.lng, variant: 'past', title: s.name, onClick: () => app.go(`trip/${s.trip_id}/stop/${s.id}`) })));
    if (withPhotos.length) fitTo(withPhotos, { maxZoom: 6 });
  }
  tripSel.addEventListener('change', draw);
  yearSel.addEventListener('change', draw);

  app.show(h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, `${photos.length} photos`), h('h1', { class: 'view-title' }, 'Photos')),
      h('div', { class: 'filters' }, tripSel, yearSel)),
    body), { wide: true });
  setRoute([]);
  draw();
}
