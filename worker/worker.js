// Vicki's Travel Planner — API on Cloudflare Workers.
// Database: D1 (binding "DB"). Photos: R2 bucket (binding "PHOTOS").
// Settings (Worker → Settings → Variables and Secrets):
//   FAMILY_CODE     secret  the code people need to create an account
//   SIGNING_KEY     secret  a long random string; signs the private photo links
//   ADMIN_EMAILS    text    comma-separated emails that may reset other people's passwords
//   ALLOWED_ORIGINS text    optional; defaults to the GitHub Pages site and localhost:8766
// This file contains no secrets and is safe to publish.

const PBKDF2_ITERATIONS = 30000;             // password hashing strength: kept under the free plan's 10 ms CPU limit; stored per hash, so it can be raised later
const SESSION_DAYS = 180;
const PHOTO_LINK_HOURS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const DEFAULT_ORIGINS = ['https://debruynbrycedbb.github.io', 'http://localhost:8766'];

const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const isoNow = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function body(request) {
  try { return await request.json(); } catch { fail(400, 'The request was not valid JSON.'); }
}

// ---------- Encoding & crypto helpers ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}
async function checkPassword(password, stored) {
  const [kind, iterations, salt] = String(stored).split('$');
  if (kind !== 'pbkdf2') return false;
  return safeEqual(await hashPassword(password, unb64url(salt), Number(iterations)), stored);
}

async function hmac(env, text) {
  if (!env.SIGNING_KEY) fail(503, 'The server is missing its SIGNING_KEY setting.');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// ---------- Guessing limits ----------
async function limited(env, key, max) {
  const row = await env.DB.prepare('SELECT count, reset_at FROM attempts WHERE key = ?').bind(key).first();
  return !!row && row.reset_at > now() && row.count >= max;
}
async function countAttempt(env, key, windowSeconds) {
  const t = now();
  await env.DB.prepare(`INSERT INTO attempts (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN attempts.reset_at <= ?3 THEN 1 ELSE attempts.count + 1 END,
      reset_at = CASE WHEN attempts.reset_at <= ?3 THEN ?2 ELSE attempts.reset_at END`)
    .bind(key, t + windowSeconds, t).run();
}
const clearAttempts = (env, key) => env.DB.prepare('DELETE FROM attempts WHERE key = ?').bind(key).run();

// ---------- Sessions ----------
async function createSession(env, userId) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, isoNow(), now() + SESSION_DAYS * 86400).run();
  return token;
}
function bearer(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) fail(401, 'Please sign in.');
  const user = await env.DB.prepare(`SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha256(token), now()).first();
  if (!user) fail(401, 'Your session has ended. Please sign in again.');
  return user;
}
const admins = (env) => (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const publicUser = (env, u) => ({ id: u.id, email: u.email, display_name: u.display_name, is_admin: admins(env).includes(String(u.email).toLowerCase()) });

// ---------- Field rules ----------
const str = (min, max) => (v, f) => {
  const s = v == null ? '' : String(v).trim();
  if (s.length < min) fail(400, `${f} is required.`);
  if (s.length > max) fail(400, `${f} is too long.`);
  return s;
};
const optStr = (max) => (v, f) => (v == null || v === '' ? null : str(0, max)(v, f));
const int = (min, max) => (v, f) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(400, `${f} is not valid.`); return n; };
const num = (min, max) => (v, f) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) fail(400, `${f} is not valid.`); return n; };
const optNum = (min, max) => (v, f) => (v == null || v === '' ? null : num(min, max)(v, f));
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const oneOf = (list) => (v, f) => { if (!list.includes(v)) fail(400, `${f} is not valid.`); return v; };
const pattern = (re, optional = true) => (v, f) => {
  if ((v == null || v === '') && optional) return null;
  if (!re.test(String(v))) fail(400, `${f} is not valid.`);
  return String(v);
};
const date = pattern(/^\d{4}-\d{2}-\d{2}$/);
const time = pattern(/^\d{2}:\d{2}(:\d{2})?$/);
const dateTime = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const currency = pattern(/^[A-Z]{3}$/, false);
const id = pattern(/^[A-Za-z0-9-]{1,64}$/, false);
const optId = pattern(/^[A-Za-z0-9-]{1,64}$/);
const links = (v) => {
  const list = Array.isArray(v) ? v : [];
  if (list.length > 30) fail(400, 'Too many links.');
  return JSON.stringify(list.map((x) => String(x).slice(0, 500)));
};

const FIELDS = {
  trips: { title: str(1, 120), start_date: date, end_date: date, summary: str(0, 2000), currency, cover_photo_id: optId },
  stops: {
    trip_id: id, day: int(0, 366), position: int(0, 100000), start_time: time, name: str(1, 160),
    kind: oneOf(['stay', 'food', 'sight', 'activity', 'transport', 'other']),
    lat: num(-90, 90), lng: num(-180, 180), place: str(0, 300), notes: str(0, 5000), links,
  },
  bookings: {
    trip_id: id, stop_id: optId, kind: oneOf(['flight', 'stay', 'train', 'bus', 'car', 'ferry', 'activity', 'other']),
    title: str(1, 160), provider: str(0, 160), reference: str(0, 160), starts_at: dateTime, ends_at: dateTime, details: str(0, 3000),
  },
  budget_items: {
    trip_id: id, stop_id: optId, category: oneOf(['transport', 'stay', 'food', 'activities', 'shopping', 'other']),
    label: str(1, 160), amount: num(0, 1e10), currency, paid: bool,
  },
  packing_items: { trip_id: id, label: str(1, 160), category: str(0, 60), packed: bool, position: int(0, 100000) },
  photos: { stop_id: optId, caption: str(0, 500) },
  wishlist: {
    name: str(1, 160), lat: num(-90, 90), lng: num(-180, 180), place: str(0, 300), notes: str(0, 5000), links,
    image_url: str(0, 500), source: str(0, 40), source_id: optStr(100),
  },
};
const REQUIRED = {
  trips: ['title'], stops: ['trip_id', 'name', 'lat', 'lng'], bookings: ['trip_id', 'title'],
  budget_items: ['trip_id', 'label'], packing_items: ['trip_id', 'label'], wishlist: ['name', 'lat', 'lng'],
};
const HAS_UPDATED_AT = new Set(['trips', 'stops']);
const READABLE = new Set(['trips', 'trip_members', 'stops', 'bookings', 'budget_items', 'packing_items', 'photos', 'wishlist']);
const COLUMNS = {
  trips: ['id', 'owner_id', 'title', 'start_date', 'end_date', 'currency', 'created_at'],
  trip_members: ['trip_id', 'user_id', 'can_see_budget', 'added_at'],
  stops: ['id', 'trip_id', 'day', 'position', 'start_time', 'name', 'kind', 'created_at'],
  bookings: ['id', 'trip_id', 'stop_id', 'kind', 'starts_at', 'created_at'],
  budget_items: ['id', 'trip_id', 'stop_id', 'category', 'created_at'],
  packing_items: ['id', 'trip_id', 'category', 'position', 'packed', 'created_at'],
  photos: ['id', 'trip_id', 'stop_id', 'uploaded_by', 'taken_at', 'created_at'],
  wishlist: ['id', 'source_id', 'created_at'],
};

function clean(table, input, { partial, existing = {} }) {
  const rules = FIELDS[table];
  const out = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (!(k in input)) continue;
    out[k] = rule(input[k], k.replace(/_/g, ' '));
  }
  if (!partial) for (const k of REQUIRED[table] || []) if (out[k] == null || out[k] === '') fail(400, `${k.replace(/_/g, ' ')} is required.`);
  if (table === 'trips') {
    const start = 'start_date' in out ? out.start_date : existing.start_date;
    const end = 'end_date' in out ? out.end_date : existing.end_date;
    if (start && end && end < start) fail(400, 'The last day is before the first day.');
  }
  return out;
}

// Rows going back to the site: real booleans and arrays.
function present(table, row) {
  if (!row) return row;
  const r = { ...row };
  if ('links' in r) { try { r.links = JSON.parse(r.links || '[]'); } catch { r.links = []; } }
  for (const k of ['can_see_budget', 'paid', 'packed']) if (k in r) r[k] = !!r[k];
  return r;
}

// ---------- Who may see what ----------
const VISIBLE = 'SELECT id FROM trips WHERE owner_id = ? UNION SELECT trip_id FROM trip_members WHERE user_id = ?';
const BUDGET_VISIBLE = 'SELECT id FROM trips WHERE owner_id = ? UNION SELECT trip_id FROM trip_members WHERE user_id = ? AND can_see_budget = 1';

function access(table, uid) {
  if (table === 'trips') return [`id IN (${VISIBLE})`, [uid, uid]];
  if (table === 'wishlist') return ['owner_id = ?', [uid]];
  if (table === 'budget_items') return [`trip_id IN (${BUDGET_VISIBLE})`, [uid, uid]];
  return [`trip_id IN (${VISIBLE})`, [uid, uid]];
}
function tripRights(env, uid) {
  const cache = new Map();
  const get = async (tripId) => {
    if (!cache.has(tripId)) {
      cache.set(tripId, env.DB.prepare(`SELECT t.owner_id, m.user_id AS member, m.can_see_budget
        FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ?`).bind(uid, tripId).first());
    }
    return cache.get(tripId);
  };
  return {
    async owner(tripId) { const r = await get(tripId); return !!r && r.owner_id === uid; },
    async view(tripId) { const r = await get(tripId); return !!r && (r.owner_id === uid || r.member === uid); },
    async requireOwner(tripId) { if (!(await this.owner(tripId))) fail(403, 'Only the person who planned this trip can change it.'); },
    async requireView(tripId) { if (!(await this.view(tripId))) fail(404, 'Trip not found.'); },
  };
}
async function stopInTrip(env, stopId, tripId) {
  if (!stopId) return;
  const s = await env.DB.prepare('SELECT trip_id FROM stops WHERE id = ?').bind(stopId).first();
  if (!s || s.trip_id !== tripId) fail(400, 'That stop is not part of this trip.');
}

// ---------- Data endpoints ----------
async function query(env, user, { table, filters = {}, order = [] }) {
  if (!READABLE.has(table)) fail(404, 'Unknown table.');
  const cols = new Set([...COLUMNS[table], ...Object.keys(FIELDS[table] || {})]);
  const [where, params] = access(table, user.id);
  const parts = [where];
  const later = [];
  for (const [k, v] of Object.entries(filters || {})) {
    if (!cols.has(k)) fail(400, `Can't filter by ${k}.`);
    if (Array.isArray(v)) { if (!v.length) return []; later.push([k, new Set(v)]); }
    else if (v === null) parts.push(`${k} IS NULL`);
    else { parts.push(`${k} = ?`); params.push(typeof v === 'boolean' ? Number(v) : v); }
  }
  const orderBy = (Array.isArray(order) ? order : []).map(([col, asc = true]) => {
    if (!cols.has(col)) fail(400, `Can't sort by ${col}.`);
    return `${col} IS NULL, ${col} ${asc ? 'ASC' : 'DESC'}`;
  });
  const sql = `SELECT * FROM ${table} WHERE ${parts.join(' AND ')}${orderBy.length ? ' ORDER BY ' + orderBy.join(', ') : ''}`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results.filter((r) => later.every(([k, set]) => set.has(r[k]))).map((r) => present(table, r));
}

async function insertRows(env, user, table, rows) {
  if (!FIELDS[table] || table === 'photos') fail(404, 'Unknown table.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) fail(400, 'Send between 1 and 100 rows.');
  const rights = tripRights(env, user.id);
  const out = [];
  const stamp = isoNow();
  for (const input of rows) {
    const row = clean(table, input, { partial: false });
    row.id = uuid();
    row.created_at = stamp;
    if (HAS_UPDATED_AT.has(table)) row.updated_at = stamp;
    if (table === 'trips') { row.owner_id = user.id; row.cover_photo_id = null; }
    else if (table === 'wishlist') row.owner_id = user.id;
    else { await rights.requireOwner(row.trip_id); await stopInTrip(env, row.stop_id, row.trip_id); }
    const keys = Object.keys(row);
    const created = await env.DB.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`)
      .bind(...keys.map((k) => row[k])).first();
    out.push(present(table, created));
  }
  return out;
}

async function loadOwned(env, user, table, rowId) {
  if (!FIELDS[table]) fail(404, 'Unknown table.');
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(rowId).first();
  if (!row) fail(404, 'Not found.');
  const rights = tripRights(env, user.id);
  if (table === 'trips') { if (row.owner_id !== user.id) fail(403, 'Only the person who planned this trip can change it.'); }
  else if (table === 'wishlist') { if (row.owner_id !== user.id) fail(404, 'Not found.'); }
  else if (table === 'photos') { if (row.uploaded_by !== user.id && !(await rights.owner(row.trip_id))) fail(403, 'You can only change your own photos.'); }
  else await rights.requireOwner(row.trip_id);
  return row;
}

async function updateRow(env, user, table, rowId, patch) {
  const row = await loadOwned(env, user, table, rowId);
  const data = clean(table, patch || {}, { partial: true, existing: row });
  delete data.trip_id;
  if ('stop_id' in data) await stopInTrip(env, data.stop_id, row.trip_id);
  if (table === 'trips' && data.cover_photo_id) {
    const p = await env.DB.prepare('SELECT trip_id FROM photos WHERE id = ?').bind(data.cover_photo_id).first();
    if (!p || p.trip_id !== row.id) fail(400, 'That photo is not part of this trip.');
  }
  if (HAS_UPDATED_AT.has(table)) data.updated_at = isoNow();
  const keys = Object.keys(data);
  if (!keys.length) return present(table, row);
  const updated = await env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`)
    .bind(...keys.map((k) => data[k]), rowId).first();
  return present(table, updated);
}

async function deletePhotoFiles(env, rows) {
  const keys = rows.flatMap((r) => [r.path, r.thumb_path]);
  for (let i = 0; i < keys.length; i += 1000) await env.PHOTOS.delete(keys.slice(i, i + 1000));
}

async function deleteRow(env, user, table, rowId) {
  if (table === 'photos') return deletePhotos(env, user, [rowId]);
  const row = await loadOwned(env, user, table, rowId);
  if (table === 'trips') {
    const { results } = await env.DB.prepare('SELECT path, thumb_path FROM photos WHERE trip_id = ?').bind(row.id).all();
    await deletePhotoFiles(env, results);
  }
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowId).run();
  return { ok: true };
}

async function memberChange(env, user, { trip_id, user_id, can_see_budget }, action) {
  id(trip_id, 'trip'); id(user_id, 'person');
  const rights = tripRights(env, user.id);
  if (action === 'remove' && user_id === user.id) {
    await env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').bind(trip_id, user_id).run();
    return { ok: true };
  }
  await rights.requireOwner(trip_id);
  if (action === 'add') {
    if (user_id === user.id) fail(400, 'You already planned this trip.');
    const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
    if (!exists) fail(404, 'That person was not found.');
    const row = await env.DB.prepare(`INSERT INTO trip_members (trip_id, user_id, can_see_budget, added_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (trip_id, user_id) DO UPDATE SET can_see_budget = excluded.can_see_budget RETURNING *`)
      .bind(trip_id, user_id, bool(can_see_budget), isoNow()).first();
    return present('trip_members', row);
  }
  if (action === 'update') {
    await env.DB.prepare('UPDATE trip_members SET can_see_budget = ? WHERE trip_id = ? AND user_id = ?').bind(bool(can_see_budget), trip_id, user_id).run();
    return { ok: true };
  }
  await env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').bind(trip_id, user_id).run();
  return { ok: true };
}

async function importWishlist(env, user, rows) {
  if (!Array.isArray(rows) || rows.length > 100) fail(400, 'Send up to 100 places.');
  const out = [];
  for (const input of rows) {
    const row = clean('wishlist', input, { partial: false });
    if (!row.source_id) fail(400, 'Imported places need a source id.');
    Object.assign(row, { id: uuid(), owner_id: user.id, created_at: isoNow() });
    const keys = Object.keys(row);
    const created = await env.DB.prepare(`INSERT INTO wishlist (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})
      ON CONFLICT (owner_id, source_id) DO NOTHING RETURNING *`).bind(...keys.map((k) => row[k])).first();
    if (created) out.push(present('wishlist', created));
  }
  return out;
}

// ---------- Photos ----------
async function uploadPhoto(env, user, request) {
  let form;
  try { form = await request.formData(); } catch { fail(400, 'The upload was not readable.'); }
  const tripId = id(form.get('trip_id'), 'trip');
  const rights = tripRights(env, user.id);
  await rights.requireView(tripId);
  let meta = {};
  try { meta = JSON.parse(form.get('meta') || '{}'); } catch { fail(400, 'Photo details were not readable.'); }
  const stopId = optId(meta.stop_id, 'stop');
  await stopInTrip(env, stopId, tripId);
  const full = form.get('full');
  const thumb = form.get('thumb');
  for (const f of [full, thumb]) {
    if (!f || typeof f === 'string') fail(400, 'The photo file is missing.');
    if (f.size > MAX_PHOTO_BYTES) fail(413, 'That photo is too large.');
    if (f.type !== 'image/jpeg') fail(415, 'Photos must be JPEG.');
  }
  const photoId = uuid();
  const path = `${tripId}/${photoId}.jpg`;
  const thumbPath = `${tripId}/${photoId}_t.jpg`;
  const httpMetadata = { contentType: 'image/jpeg' };
  await env.PHOTOS.put(path, await full.arrayBuffer(), { httpMetadata });
  await env.PHOTOS.put(thumbPath, await thumb.arrayBuffer(), { httpMetadata });
  try {
    const row = await env.DB.prepare(`INSERT INTO photos (id, trip_id, stop_id, uploaded_by, path, thumb_path, width, height, taken_at, lat, lng, caption, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(
      photoId, tripId, stopId, user.id, path, thumbPath,
      optNum(1, 100000)(meta.width, 'width'), optNum(1, 100000)(meta.height, 'height'),
      dateTime(meta.taken_at, 'time taken'), optNum(-90, 90)(meta.lat, 'latitude'), optNum(-180, 180)(meta.lng, 'longitude'),
      str(0, 500)(meta.caption, 'caption'), isoNow(),
    ).first();
    return present('photos', row);
  } catch (e) {
    await env.PHOTOS.delete([path, thumbPath]);
    throw e;
  }
}

async function deletePhotos(env, user, ids) {
  if (!Array.isArray(ids) || ids.length > 500) fail(400, 'Send up to 500 photos.');
  const rights = tripRights(env, user.id);
  const rows = [];
  for (const pid of ids) {
    const row = await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id(pid, 'photo')).first();
    if (!row) continue;
    if (row.uploaded_by !== user.id && !(await rights.owner(row.trip_id))) fail(403, 'You can only delete your own photos.');
    rows.push(row);
  }
  await deletePhotoFiles(env, rows);
  for (const row of rows) {
    await env.DB.batch([
      env.DB.prepare('UPDATE trips SET cover_photo_id = NULL WHERE cover_photo_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(row.id),
    ]);
  }
  return { ok: true, deleted: rows.length };
}

// Private photo links: the same address for an hour, so browsers can cache them.
async function signPaths(env, user, request, paths) {
  if (!Array.isArray(paths) || paths.length > 1000) fail(400, 'Send up to 1000 photos.');
  const rights = tripRights(env, user.id);
  const origin = new URL(request.url).origin;
  const expires = (Math.floor(now() / 3600) + 1 + PHOTO_LINK_HOURS) * 3600;
  const out = {};
  for (const p of paths) {
    if (typeof p !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_-]+\.jpg$/.test(p)) continue;
    if (!(await rights.view(p.split('/')[0]))) continue;
    out[p] = `${origin}/img/${p}?e=${expires}&s=${await hmac(env, `${p}:${expires}`)}`;
  }
  return out;
}
async function servePhoto(env, url) {
  const path = decodeURIComponent(url.pathname.slice('/img/'.length));
  const e = Number(url.searchParams.get('e'));
  const s = url.searchParams.get('s') || '';
  if (!e || e < now() || !safeEqual(s, await hmac(env, `${path}:${e}`))) return new Response('This photo link has expired.', { status: 403 });
  const obj = await env.PHOTOS.get(path);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': `private, max-age=${Math.max(60, e - now())}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ---------- Accounts ----------
const cleanEmail = (v) => {
  const e = String(v || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) fail(400, 'Enter a valid email address.');
  return e;
};
const cleanPassword = (v) => {
  const p = String(v || '');
  if (p.length < 8) fail(400, 'Use a password with at least 8 characters.');
  if (p.length > 200) fail(400, 'That password is too long.');
  return p;
};

async function signUp(env, request) {
  const b = await body(request);
  if (!env.FAMILY_CODE) fail(503, 'Sign-up is not set up yet (the family code is missing).');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `code:${ip}`;
  if (await limited(env, key, 10)) fail(429, 'Too many wrong family codes. Try again in an hour.');
  const name = str(1, 60)(b.name, 'Your name');
  const email = cleanEmail(b.email);
  const password = cleanPassword(b.password);
  if (!safeEqual(await sha256(String(b.code || '').trim()), await sha256(String(env.FAMILY_CODE).trim()))) {
    await countAttempt(env, key, 3600);
    fail(400, "That family code isn't right.");
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (taken) fail(409, 'That email already has an account. Sign in instead.');
  const user = { id: uuid(), email, display_name: name };
  await env.DB.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, email, name, await hashPassword(password), isoNow()).run();
  return json({ token: await createSession(env, user.id), user: publicUser(env, user) });
}

async function signIn(env, request) {
  const b = await body(request);
  const email = cleanEmail(b.email);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const keys = [`login:${email}`, `loginip:${ip}`];
  if (await limited(env, keys[0], 10) || await limited(env, keys[1], 40)) fail(429, 'Too many tries. Wait 15 minutes and try again.');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const ok = user ? await checkPassword(String(b.password || ''), user.password_hash) : (await hashPassword('x'), false);
  if (!ok) {
    for (const k of keys) await countAttempt(env, k, 900);
    fail(401, 'Email or password is wrong.');
  }
  await clearAttempts(env, keys[0]);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
  return json({ token: await createSession(env, user.id), user: publicUser(env, user) });
}

async function changePassword(env, request, user) {
  const b = await body(request);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!(await checkPassword(String(b.current || ''), row.password_hash))) fail(400, 'Your current password is wrong.');
  const password = cleanPassword(b.password);
  const current = await sha256(bearer(request));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, current),
  ]);
  return json({ ok: true });
}

async function adminResetPassword(env, request, user) {
  if (!publicUser(env, user).is_admin) fail(403, 'Only an admin can reset passwords.');
  const b = await body(request);
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id(b.user_id, 'person')).first();
  if (!target) fail(404, 'That person was not found.');
  const password = cleanPassword(b.password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), target.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
  ]);
  return json({ ok: true });
}

// Setup check shown at the Worker's address: says what's connected, never any values.
async function status(env) {
  const checks = {
    database: 'not connected (add a D1 binding named DB)',
    tables: 'unknown',
    photos: env.PHOTOS ? 'connected' : 'not connected (add an R2 binding named PHOTOS)',
    family_code: env.FAMILY_CODE ? 'set' : 'missing (add the FAMILY_CODE secret)',
    signing_key: env.SIGNING_KEY ? 'set' : 'missing (add the SIGNING_KEY secret)',
    admins: admins(env).length ? `${admins(env).length} set` : 'none (add ADMIN_EMAILS)',
  };
  if (env.DB) {
    checks.database = 'connected';
    try {
      const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const have = new Set(results.map((r) => r.name));
      const missing = ['users', 'sessions', 'attempts', 'trips', 'trip_members', 'stops', 'bookings', 'budget_items', 'packing_items', 'photos', 'wishlist'].filter((t) => !have.has(t));
      checks.tables = missing.length ? `missing: ${missing.join(', ')} (run worker/schema.sql in the D1 Console)` : 'all there';
    } catch { checks.tables = 'could not be read'; }
  }
  const ok = checks.database === 'connected' && checks.tables === 'all there' && checks.photos === 'connected' && checks.family_code === 'set' && checks.signing_key === 'set';
  return { ok, app: "Vicki's Travel Planner API", checks };
}

// ---------- Router ----------
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  if (m === 'GET' && path === '/') return json(await status(env));
  if (m === 'GET' && path.startsWith('/img/')) return servePhoto(env, url);
  if (m === 'POST' && path === '/auth/signup') return signUp(env, request);
  if (m === 'POST' && path === '/auth/signin') return signIn(env, request);

  const user = await currentUser(request, env);
  if (m === 'GET' && path === '/auth/me') return json(publicUser(env, user));
  if (m === 'PATCH' && path === '/auth/me') {
    const name = str(1, 60)((await body(request)).display_name, 'Your name');
    await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, user.id).run();
    return json({ ...publicUser(env, user), display_name: name });
  }
  if (m === 'POST' && path === '/auth/signout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(bearer(request))).run();
    return json({ ok: true });
  }
  if (m === 'POST' && path === '/auth/password') return changePassword(env, request, user);
  if (m === 'POST' && path === '/admin/reset-password') return adminResetPassword(env, request, user);

  if (m === 'GET' && path === '/api/profiles') {
    const { results } = await env.DB.prepare('SELECT id, display_name FROM users ORDER BY display_name COLLATE NOCASE').all();
    return json(results);
  }
  if (m === 'POST' && path === '/api/query') return json(await query(env, user, await body(request)));
  if (m === 'POST' && path.startsWith('/api/members/')) return json(await memberChange(env, user, await body(request), path.split('/')[3]));
  if (m === 'POST' && path === '/api/wishlist/import') return json(await importWishlist(env, user, (await body(request)).rows));
  if (m === 'POST' && path === '/photos/upload') return json(await uploadPhoto(env, user, request));
  if (m === 'POST' && path === '/photos/delete') return json(await deletePhotos(env, user, (await body(request)).ids));
  if (m === 'POST' && path === '/photos/sign') return json(await signPaths(env, user, request, (await body(request)).paths));

  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts.length === 2 && m === 'POST') return json(await insertRows(env, user, parts[1], (await body(request)).rows));
  if (parts[0] === 'api' && parts.length === 3 && m === 'PATCH') return json(await updateRow(env, user, parts[1], parts[2], await body(request)));
  if (parts[0] === 'api' && parts.length === 3 && m === 'DELETE') return json(await deleteRow(env, user, parts[1], parts[2]));

  fail(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
    const cors = allowed.includes(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } : { Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res = json({ error: status === 500 ? 'Something went wrong on the server.' : e.message }, status);
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
