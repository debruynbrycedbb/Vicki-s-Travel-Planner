// Wishlist: places you'd like to go some day, as gold pins. Private to you.
import { db } from '../db.js?v=1';
import { h, icon, attempt, toast, openDialog, confirmDialog, field, input, textarea, emptyState } from '../ui.js?v=1';
import { setPins, setRoute, fitTo, flyTo, pickPoint, worldView } from '../map.js?v=1';
import { searchPlaces, reversePlace, parseCoords, isShortGoogleLink } from '../places.js?v=1';

export async function renderWishlist(app, stale, focusId) {
  const items = await db.list('wishlist', {}, [['created_at', false]]);
  if (stale()) return;

  const q = input({ type: 'search', placeholder: 'Add a place: search, or paste a map link', 'aria-label': 'Add a place to your wishlist', autocomplete: 'off' });
  const results = h('div', { class: 'add-results' });
  const add = async (p) => {
    results.replaceChildren(); q.value = '';
    const row = await attempt(() => db.insert('wishlist', { name: p.name || 'Dropped pin', place: p.place || '', lat: p.lat, lng: p.lng }), 'Added to your wishlist');
    if (row) app.go(`wishlist/${row.id}`);
  };
  const search = async () => {
    const text = q.value.trim();
    if (!text) return;
    if (isShortGoogleLink(text)) { results.replaceChildren(h('p', { class: 'search-note' }, 'Short Google links can’t be read. Open the link, then copy the long address from the browser bar.')); return; }
    const c = parseCoords(text);
    if (c && /^https?:/.test(text)) { add({ ...c, ...(await reversePlace(c)) }); return; }
    results.replaceChildren(h('p', { class: 'search-note' }, 'Searching…'));
    try {
      const hits = await searchPlaces(text);
      results.replaceChildren(...(hits.length ? hits.map((p) => h('button', { type: 'button', class: 'search-row', onclick: () => add(p) },
        icon('star', 16), h('span', { class: 'search-row-main' }, p.name), h('span', { class: 'search-row-sub' }, p.place)))
        : [h('p', { class: 'search-note' }, 'No places found. Try adding the town or country.')]));
    } catch { results.replaceChildren(h('p', { class: 'search-note' }, 'Place search isn’t answering. Try again in a moment.')); }
  };

  const card = (w) => h('li', { class: `wish${w.id === focusId ? ' is-focus' : ''}`, id: `w-${w.id}` },
    w.image_url ? h('img', { class: 'wish-img', src: w.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'wish-img wish-img-empty', 'aria-hidden': 'true' }, icon('star', 22)),
    h('div', { class: 'wish-body' },
      h('h3', { class: 'card-title' }, h('a', { href: `#/wishlist/${w.id}` }, w.name)),
      w.place ? h('p', { class: 'muted small' }, w.place) : null,
      w.notes ? h('p', { class: 'small notes' }, w.notes) : null,
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => app.addPlaceToTrip({ ...w, wishlistId: w.id }) }, 'Add to a trip'),
        h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => editWish(app, w) }, 'Edit'),
        h('button', { class: 'btn btn-small btn-quiet danger-text', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Remove from wishlist?', `“${w.name}” will be removed.`, 'Remove'))) return;
          if (await attempt(() => db.remove('wishlist', w.id), 'Removed')) app.go('wishlist');
        } }, 'Remove'))));

  app.show(h('div', { class: 'view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Only you can see this'), h('h1', { class: 'view-title' }, 'Wishlist'))),
    h('p', { class: 'muted' }, 'Places you’d like to go one day. When you plan a trip, add them to it.'),
    h('div', { class: 'add-stop' },
      h('form', { class: 'add-stop-row', onsubmit: (e) => { e.preventDefault(); search(); } },
        q, h('button', { class: 'btn', type: 'submit' }, 'Search'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
          if (app.isMobile()) app.setSheet('peek');
          const p = await pickPoint('Tap the map to drop a wishlist pin');
          if (app.isMobile()) app.setSheet('half');
          if (p) add({ ...p, ...(await reversePlace(p)) });
        } }, icon('pin', 16), h('span', { class: 'hide-sm' }, 'Pick on map'))),
      results),
    items.length ? h('ul', { class: 'wish-list' }, items.map(card))
      : emptyState('Your wishlist is empty', 'Search for a place above, or right-click anywhere on the map.')));

  setRoute([]);
  setPins(items.map((w) => ({ lat: w.lat, lng: w.lng, variant: 'wishlist', title: w.name, active: w.id === focusId, onClick: () => app.go(`wishlist/${w.id}`) })));
  const focus = items.find((w) => w.id === focusId);
  if (focus) {
    flyTo(focus, 9);
    document.getElementById(`w-${focus.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (items.length) fitTo(items, { maxZoom: 6 });
  else worldView();
}

function editWish(app, w) {
  const name = input({ value: w.name, maxlength: 160 });
  const place = input({ value: w.place, maxlength: 300 });
  const notes = textarea({ maxlength: 5000 });
  notes.value = w.notes || '';
  openDialog({
    title: 'Edit wishlist place',
    body: h('div', { class: 'form' }, field('Name', name), field('Address or area', place), field('Notes', notes)),
    actions: [{ label: 'Cancel' }, { label: 'Save changes', kind: 'primary', onClick: async () => {
      if (!name.value.trim()) { toast('Give the place a name.', 'error'); return false; }
      if (await attempt(() => db.update('wishlist', w.id, { name: name.value.trim(), place: place.value.trim(), notes: notes.value.trim() }), 'Changes saved')) app.refresh();
    } }],
  });
}
