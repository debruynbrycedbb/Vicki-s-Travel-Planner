// Play the trip: the map flies stop to stop, drawing the route, with each stop's photos.
import { db, loadTrips, photoUrls } from './db.js?v=2';
import { h, icon, fmtRange, dayLabel, dayColour, KINDS, tripDays } from './ui.js?v=2';
import { setPins, setRoute, flyTo, fitTo, worldView, getMap } from './map.js?v=2';
import { orderStops } from './views/trip.js?v=2';
import { distanceKm } from './places.js?v=2';

export async function playTrip(app, id) {
  const trip = (await loadTrips()).find((t) => t.id === id);
  if (!trip) { app.go('trips'); return; }
  const [raw, photos] = await Promise.all([
    db.list('stops', { trip_id: id }),
    db.list('photos', { trip_id: id }, [['taken_at', true], ['created_at', true]]),
  ]);
  const stops = orderStops(raw).filter((s) => s.day);
  if (!stops.length) { app.go(`trip/${id}`); return; }
  const url = await photoUrls(photos);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let idx = -1, paused = false, token = 0;
  const wait = (ms, t) => new Promise((resolve) => {
    let left = ms;
    const tick = () => {
      if (t !== token) return resolve(false);
      if (!paused) left -= 100;
      if (left <= 0) return resolve(true);
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });

  const titleEl = h('div', { class: 'player-title' });
  const dayEl = h('div', { class: 'player-day', 'aria-live': 'polite' });
  const cardEl = h('div', { class: 'player-card', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Pause', onclick: () => togglePause() }, icon('pause', 20));
  const progress = h('span', { class: 'player-progress mono small' });
  const overlay = h('div', { class: 'player' },
    titleEl, dayEl, cardEl,
    h('div', { class: 'player-controls' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous stop', onclick: () => jump(idx - 1) }, icon('prev', 20)),
      playBtn,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next stop', onclick: () => jump(idx + 1) }, icon('next', 20)),
      progress,
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: () => exit() }, 'Close')));

  function togglePause() {
    paused = !paused;
    playBtn.replaceChildren(icon(paused ? 'play' : 'pause', 20));
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }
  const onKey = (e) => {
    if (e.key === 'Escape') exit();
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'ArrowRight') jump(idx + 1);
    else if (e.key === 'ArrowLeft') jump(idx - 1);
  };
  function exit() {
    token++;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('is-playing');
    app.go(`trip/${id}`);
    if (location.hash === `#/trip/${id}`) app.refresh();
  }

  function drawProgress(k) {
    setPins(stops.slice(0, k + 1).map((s, n) => ({ lat: s.lat, lng: s.lng, variant: 'stop', label: String(s.num), colour: dayColour(s.day), title: s.name, active: n === k })));
    const segs = [];
    for (let n = 1; n <= k; n++) {
      const a = stops[n - 1], b = stops[n];
      segs.push({ coords: [[a.lng, a.lat], [b.lng, b.lat]], colour: dayColour(b.day), between: a.day !== b.day });
    }
    setRoute(segs);
    progress.textContent = `${k + 1} / ${stops.length}`;
  }

  async function showStop(k, t) {
    const s = stops[k];
    const prev = stops[k - 1];
    drawProgress(k - 1 >= 0 ? k - 1 : -1);
    cardEl.classList.remove('is-in');
    if (!prev || prev.day !== s.day) {
      dayEl.replaceChildren(h('span', { class: 'player-day-swatch', style: `--c:${dayColour(s.day)}` }), dayLabel(trip, s.day));
      dayEl.classList.add('is-in');
    }
    const far = prev ? distanceKm(prev, s) : 1000;
    const zoom = far > 300 ? 11 : 14;
    await flyTo(s, zoom, reduced ? 0 : far > 300 ? 3200 : far > 20 ? 2200 : 1400);
    if (t !== token) return false;
    dayEl.classList.remove('is-in');
    drawProgress(k);
    const mine = photos.filter((p) => p.stop_id === s.id).slice(0, 8);
    const img = h('img', { class: 'player-photo', alt: '' });
    cardEl.replaceChildren(
      mine.length ? img : null,
      h('div', { class: 'player-card-text' },
        h('p', { class: 'eyebrow' }, h('span', { class: 'num', style: `--c:${dayColour(s.day)}` }, s.num), ' ', KINDS[s.kind], s.start_time ? ` · ${s.start_time.slice(0, 5)}` : ''),
        h('p', { class: 'player-stop' }, s.name),
        s.place ? h('p', { class: 'muted small' }, s.place) : null));
    cardEl.classList.add('is-in');
    if (!mine.length) return wait(2600, t);
    for (const p of mine) {
      img.src = url(p, 'full') || url(p);
      img.alt = p.caption || `Photo at ${s.name}`;
      if (!(await wait(mine.length > 1 ? 2000 : 3000, t))) return false;
    }
    return true;
  }

  async function run(from) {
    const t = ++token;
    for (let k = from; k < stops.length; k++) {
      idx = k;
      if (!(await showStop(k, t))) return;
    }
    // The end
    cardEl.classList.remove('is-in');
    drawProgress(stops.length - 1);
    fitTo(stops, { maxZoom: 12, duration: reduced ? 0 : 2000 });
    const days = tripDays(trip) || new Set(stops.map((s) => s.day)).size;
    cardEl.replaceChildren(h('div', { class: 'player-card-text player-end' },
      h('p', { class: 'player-stop' }, trip.title),
      h('p', { class: 'muted' }, `${days} days · ${stops.length} stops${photos.length ? ` · ${photos.length} photos` : ''}`),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { if (paused) togglePause(); run(0); } }, icon('play', 14), 'Play again'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => exit() }, 'Back to the trip'))));
    cardEl.classList.add('is-in');
  }
  function jump(k) {
    if (k < 0 || k >= stops.length) return;
    getMap().stop();
    run(k);
  }

  // Intro
  document.body.classList.add('is-playing');
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  titleEl.replaceChildren(h('p', { class: 'eyebrow' }, fmtRange(trip.start_date, trip.end_date)), h('p', { class: 'player-trip' }, trip.title));
  setRoute([]); setPins([]);
  worldView();
  titleEl.classList.add('is-in');
  const t0 = ++token;
  if (await wait(2200, t0)) { titleEl.classList.remove('is-in'); titleEl.classList.add('is-small'); run(0); }
}
