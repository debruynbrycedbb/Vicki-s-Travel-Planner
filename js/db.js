// Data layer. Every screen talks to `db`: either the Cloudflare Worker API, or the demo
// store (this browser only) when no API address is set yet or ?demo is in the URL.
import { CONFIG } from './config.js?v=1';
import { demoBackend } from './demo-db.js?v=1';

const wantsDemo = new URLSearchParams(location.search).has('demo') || !CONFIG.API_URL;
const TOKEN_KEY = 'vtp:token';

function cloudflareBackend() {
  const base = CONFIG.API_URL.replace(/\/+$/, '');
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  let me = null;
  let onSignedOut = () => {};

  const saveToken = (t) => {
    token = t;
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {}
  };

  async function call(method, path, data, { form = false, auth = true } = {}) {
    const headers = {};
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (data !== undefined && !form) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: data === undefined ? undefined : form ? data : JSON.stringify(data) });
    } catch {
      throw new Error("Can't reach the server. Check your internet connection and try again.");
    }
    let out = null;
    try { out = await res.json(); } catch {}
    if (res.status === 401 && auth && path !== '/auth/password') {
      saveToken(null);
      if (me) { me = null; onSignedOut(); }
    }
    if (!res.ok) throw new Error(out?.error || `The server answered with an error (${res.status}).`);
    return out;
  }

  return {
    demo: false,
    get me() { return me; },

    async session() {
      if (!token) return null;
      try { me = await call('GET', '/auth/me'); } catch { me = null; }
      return me;
    },
    onAuthChange(cb) { onSignedOut = () => cb('signed-out'); },
    async signUp({ name, email, password, code }) {
      const r = await call('POST', '/auth/signup', { name, email, password, code }, { auth: false });
      saveToken(r.token);
      return (me = r.user);
    },
    async signIn({ email, password }) {
      const r = await call('POST', '/auth/signin', { email, password }, { auth: false });
      saveToken(r.token);
      return (me = r.user);
    },
    async signOut() {
      try { await call('POST', '/auth/signout', {}); } catch {}
      saveToken(null);
      me = null;
    },
    async setPassword(current, password) { await call('POST', '/auth/password', { current, password }); },
    async adminResetPassword(user_id, password) { await call('POST', '/admin/reset-password', { user_id, password }); },
    async updateName(display_name) {
      me = await call('PATCH', '/auth/me', { display_name });
    },

    listProfiles: () => call('GET', '/api/profiles'),
    list: (table, filters = {}, order = []) => call('POST', '/api/query', { table, filters, order }),
    async insert(table, row) {
      const many = Array.isArray(row);
      if (table === 'trip_members') return call('POST', '/api/members/add', row);
      const rows = await call('POST', `/api/${table}`, { rows: many ? row : [row] });
      return many ? rows : rows[0];
    },
    update: (table, id, patch) => call('PATCH', `/api/${table}/${encodeURIComponent(id)}`, patch),
    async remove(table, id) { await call('DELETE', `/api/${table}/${encodeURIComponent(id)}`); },
    upsertWishlist: (rows) => call('POST', '/api/wishlist/import', { rows }),
    async updateMember(trip_id, user_id, patch) { await call('POST', '/api/members/update', { trip_id, user_id, ...patch }); },
    async removeMember(trip_id, user_id) { await call('POST', '/api/members/remove', { trip_id, user_id }); },

    async uploadPhoto(trip_id, { full, thumb }, meta) {
      const form = new FormData();
      form.append('trip_id', trip_id);
      form.append('meta', JSON.stringify(meta));
      form.append('full', full, 'photo.jpg');
      form.append('thumb', thumb, 'thumb.jpg');
      return call('POST', '/photos/upload', form, { form: true });
    },
    async deletePhotos(rows) {
      if (rows.length) await call('POST', '/photos/delete', { ids: rows.map((r) => r.id) });
    },
    async signedUrls(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 500) Object.assign(out, await call('POST', '/photos/sign', { paths: paths.slice(i, i + 500) }));
      return out;
    },
  };
}

export const db = wantsDemo ? demoBackend() : cloudflareBackend();

// Trips I can see, with my role on each. Shared by several screens.
export async function loadTrips() {
  const me = db.me;
  const [trips, members] = await Promise.all([
    db.list('trips', {}, [['start_date', true]]),
    db.list('trip_members', {}),
  ]);
  return trips.map((t) => {
    const mine = members.find((m) => m.trip_id === t.id && m.user_id === me.id);
    return {
      ...t,
      role: t.owner_id === me.id ? 'owner' : 'viewer',
      canSeeBudget: t.owner_id === me.id || !!mine?.can_see_budget,
      members: members.filter((m) => m.trip_id === t.id),
    };
  });
}

// Signed photo addresses, cached for this visit.
const urlCache = {};
export async function photoUrls(rows) {
  const need = [];
  for (const r of rows) for (const p of [r.path, r.thumb_path]) if (p && !urlCache[p]) need.push(p);
  if (need.length) Object.assign(urlCache, await db.signedUrls([...new Set(need)]));
  return (row, size = 'thumb') => urlCache[size === 'full' ? row.path : row.thumb_path] || '';
}
