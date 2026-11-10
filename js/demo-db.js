// Demo store: same interface as the Cloudflare Worker backend, saved in this browser.
// Used before the Worker address is set in config.js, or with ?demo in the address.
const KEY = 'vtp:demo:v1';
const SESSION = 'vtp:demo:session';
const ME = 'demo-me';
const OTHER = 'demo-companion';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

function seed() {
  const now = new Date().toISOString();
  const lisbon = uid();
  const kyoto = uid();
  const stop = (trip_id, day, position, name, kind, lat, lng, place, start_time = null) => ({
    id: uid(), trip_id, day, position, name, kind, lat, lng, place, start_time,
    notes: '', links: [], created_at: now, updated_at: now,
  });
  return {
    profiles: [
      { id: ME, display_name: 'You (demo)' },
      { id: OTHER, display_name: 'Sample companion' },
    ],
    trips: [
      { id: lisbon, owner_id: ME, title: 'Sample trip: Lisbon', start_date: addDays(40), end_date: addDays(44),
        summary: 'A sample trip to try the planner. Edit or delete it.', currency: 'EUR', cover_photo_id: null, created_at: now, updated_at: now },
      { id: kyoto, owner_id: OTHER, title: 'Sample trip: Kyoto', start_date: addDays(-120), end_date: addDays(-114),
        summary: 'A sample trip someone else planned and invited you to.', currency: 'JPY', cover_photo_id: null, created_at: now, updated_at: now },
    ],
    trip_members: [{ trip_id: kyoto, user_id: ME, can_see_budget: false, added_at: now }],
    stops: [
      stop(lisbon, 1, 0, 'Belém Tower', 'sight', 38.6916, -9.216, 'Belém, Lisbon', '10:00'),
      stop(lisbon, 1, 1, 'Jerónimos Monastery', 'sight', 38.6979, -9.2068, 'Belém, Lisbon', '12:00'),
      stop(lisbon, 2, 0, 'São Jorge Castle', 'sight', 38.7139, -9.1335, 'Alfama, Lisbon'),
      stop(lisbon, 2, 1, 'Miradouro de Santa Luzia', 'sight', 38.7118, -9.1302, 'Alfama, Lisbon'),
      stop(lisbon, 3, 0, 'Pena Palace', 'sight', 38.7876, -9.3906, 'Sintra'),
      stop(kyoto, 1, 0, 'Fushimi Inari Taisha', 'sight', 34.9671, 135.7727, 'Fushimi, Kyoto'),
      stop(kyoto, 2, 0, 'Kiyomizu-dera', 'sight', 34.9949, 135.785, 'Higashiyama, Kyoto'),
      stop(kyoto, 3, 0, 'Arashiyama Bamboo Grove', 'sight', 35.017, 135.6713, 'Arashiyama, Kyoto'),
    ],
    bookings: [], budget_items: [], packing_items: [], photos: [], wishlist: [], _files: {},
  };
}

export function demoBackend() {
  let store;
  try { store = JSON.parse(localStorage.getItem(KEY)); } catch { store = null; }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch { throw new Error('The demo is full (it saves in this browser only). Delete some demo photos.'); }
  };
  if (!store) { store = seed(); try { save(); } catch {} }
  let me = null;
  const signedIn = () => { try { return localStorage.getItem(SESSION); } catch { return null; } };

  const tripOf = (id) => store.trips.find((t) => t.id === id);
  const canView = (tripId) => {
    const t = tripOf(tripId);
    return !!t && (t.owner_id === ME || store.trip_members.some((m) => m.trip_id === tripId && m.user_id === ME));
  };
  const isOwner = (tripId) => tripOf(tripId)?.owner_id === ME;
  const canBudget = (tripId) => isOwner(tripId) || store.trip_members.some((m) => m.trip_id === tripId && m.user_id === ME && m.can_see_budget);
  const deny = () => { throw new Error("You don't have permission to change this."); };

  function visible(table, row) {
    switch (table) {
      case 'trips': return canView(row.id);
      case 'budget_items': return canBudget(row.trip_id);
      case 'wishlist': return row.owner_id === ME;
      case 'profiles': return true;
      default: return canView(row.trip_id);
    }
  }
  function mayWrite(table, row, kind) {
    switch (table) {
      case 'trips': return kind === 'insert' ? true : row.owner_id === ME;
      case 'wishlist': return row.owner_id === ME;
      case 'photos': return kind === 'insert' ? canView(row.trip_id) : (row.uploaded_by === ME || isOwner(row.trip_id));
      case 'trip_members': return isOwner(row.trip_id) || (kind === 'delete' && row.user_id === ME);
      default: return isOwner(row.trip_id);
    }
  }
  const matches = (row, filters = {}) => Object.entries(filters).every(([k, v]) =>
    Array.isArray(v) ? v.includes(row[k]) : v === null ? row[k] == null : row[k] === v);
  const defaults = (table) => {
    const now = new Date().toISOString();
    const base = { id: uid(), created_at: now };
    if (table === 'trips') return { ...base, owner_id: ME, summary: '', currency: 'EUR', cover_photo_id: null, updated_at: now };
    if (table === 'wishlist') return { ...base, owner_id: ME, place: '', notes: '', links: [], image_url: '', source: 'manual', source_id: null };
    if (table === 'stops') return { ...base, day: 0, position: 0, start_time: null, kind: 'sight', place: '', notes: '', links: [], updated_at: now };
    if (table === 'photos') return { ...base, uploaded_by: ME, stop_id: null, caption: '' };
    if (table === 'trip_members') return { can_see_budget: false, added_at: now };
    if (table === 'packing_items') return { ...base, category: 'Other', packed: false, position: 0 };
    if (table === 'budget_items') return { ...base, category: 'other', amount: 0, currency: 'EUR', paid: false, stop_id: null };
    if (table === 'bookings') return { ...base, kind: 'other', provider: '', reference: '', details: '', stop_id: null, starts_at: null, ends_at: null };
    return base;
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const blobToDataUrl = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
  });

  function cascadeTrip(id) {
    for (const t of ['stops', 'bookings', 'budget_items', 'packing_items', 'trip_members']) store[t] = store[t].filter((r) => r.trip_id !== id);
    for (const p of store.photos.filter((r) => r.trip_id === id)) { delete store._files[p.path]; delete store._files[p.thumb_path]; }
    store.photos = store.photos.filter((r) => r.trip_id !== id);
  }

  return {
    demo: true,
    get me() { return me; },
    async session() {
      if (!signedIn()) return null;
      me = { id: ME, email: 'demo@example.com', display_name: store.profiles.find((p) => p.id === ME).display_name, is_admin: true };
      return me;
    },
    onAuthChange() {},
    async signUp({ name }) {
      if (name) store.profiles.find((p) => p.id === ME).display_name = name;
      save();
      return this.signIn({});
    },
    async signIn() { try { localStorage.setItem(SESSION, '1'); } catch {} return this.session(); },
    async signOut() { try { localStorage.removeItem(SESSION); } catch {} me = null; },
    async setPassword() {},
    async adminResetPassword() {},
    async updateName(name) { store.profiles.find((p) => p.id === ME).display_name = name; me.display_name = name; save(); },

    async listProfiles() { return clone(store.profiles); },

    async list(table, filters, order = []) {
      let rows = store[table].filter((r) => visible(table, r) && matches(r, filters));
      rows = rows.slice().sort((a, b) => {
        for (const [col, asc = true] of order) {
          const x = a[col], y = b[col];
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
      return clone(rows);
    },
    async insert(table, row) {
      const rows = (Array.isArray(row) ? row : [row]).map((r) => ({ ...defaults(table), ...r }));
      for (const r of rows) if (!mayWrite(table, r, 'insert')) deny();
      store[table].push(...rows);
      save();
      return clone(Array.isArray(row) ? rows : rows[0]);
    },
    async update(table, id, patch) {
      const r = store[table].find((x) => x.id === id);
      if (!r || !mayWrite(table, r, 'update')) deny();
      Object.assign(r, patch, r.updated_at ? { updated_at: new Date().toISOString() } : {});
      save();
      return clone(r);
    },
    async remove(table, id) {
      const r = store[table].find((x) => x.id === id);
      if (!r) return;
      if (!mayWrite(table, r, 'delete')) deny();
      store[table] = store[table].filter((x) => x.id !== id);
      if (table === 'trips') cascadeTrip(id);
      if (table === 'stops') {
        for (const t of ['photos', 'bookings', 'budget_items']) for (const x of store[t]) if (x.stop_id === id) x.stop_id = null;
      }
      save();
    },
    async upsertWishlist(rows) {
      const added = [];
      for (const r of rows) {
        if (store.wishlist.some((w) => w.owner_id === ME && w.source_id === r.source_id)) continue;
        const row = { ...defaults('wishlist'), ...r };
        store.wishlist.push(row);
        added.push(row);
      }
      save();
      return clone(added);
    },
    async updateMember(trip_id, user_id, patch) {
      const m = store.trip_members.find((x) => x.trip_id === trip_id && x.user_id === user_id);
      if (!m || !isOwner(trip_id)) deny();
      Object.assign(m, patch); save();
    },
    async removeMember(trip_id, user_id) {
      if (!isOwner(trip_id) && user_id !== ME) deny();
      store.trip_members = store.trip_members.filter((x) => !(x.trip_id === trip_id && x.user_id === user_id));
      save();
    },
    async uploadPhoto(trip_id, { thumb }, meta) {
      if (!canView(trip_id)) deny();
      const id = uid();
      const path = `${trip_id}/${id}.jpg`;
      const thumb_path = `${trip_id}/${id}_t.jpg`;
      const url = await blobToDataUrl(thumb);   // the demo keeps only the small copy
      store._files[path] = url;
      store._files[thumb_path] = url;
      const row = { ...defaults('photos'), id, trip_id, path, thumb_path, ...meta };
      store.photos.push(row);
      try { save(); } catch (e) {
        store.photos.pop(); delete store._files[path]; delete store._files[thumb_path];
        throw e;
      }
      return clone(row);
    },
    async deletePhotos(rows) {
      for (const r of rows) {
        const row = store.photos.find((p) => p.id === r.id);
        if (!row) continue;
        if (!mayWrite('photos', row, 'delete')) deny();
        delete store._files[row.path]; delete store._files[row.thumb_path];
        for (const t of store.trips) if (t.cover_photo_id === row.id) t.cover_photo_id = null;
      }
      const ids = new Set(rows.map((r) => r.id));
      store.photos = store.photos.filter((p) => !ids.has(p.id));
      save();
    },
    async signedUrls(paths) {
      const out = {};
      for (const p of paths) if (store._files[p]) out[p] = store._files[p];
      return out;
    },
    resetDemo() { store = seed(); save(); },
  };
}
