-- Vicki's Travel Planner: database tables for Cloudflare D1.
-- Run once: Cloudflare → Storage & Databases → D1 → your database → Console → paste → Execute.
-- Safe to publish: no keys, passwords or family code in here.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Counts wrong family codes and wrong passwords, to slow down guessing.
CREATE TABLE IF NOT EXISTS attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  start_date     TEXT,
  end_date       TEXT,
  summary        TEXT NOT NULL DEFAULT '',
  currency       TEXT NOT NULL DEFAULT 'EUR',
  cover_photo_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Companions: view-only access to one trip.
CREATE TABLE IF NOT EXISTS trip_members (
  trip_id        TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  can_see_budget INTEGER NOT NULL DEFAULT 0,
  added_at       TEXT NOT NULL,
  PRIMARY KEY (trip_id, user_id)
);

-- day 0 = not scheduled yet, day 1 = the trip's first day.
CREATE TABLE IF NOT EXISTS stops (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  day        INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'sight',
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  place      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  links      TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Times are local to the destination ("YYYY-MM-DDTHH:MM").
CREATE TABLE IF NOT EXISTS bookings (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  stop_id    TEXT REFERENCES stops (id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'other',
  title      TEXT NOT NULL,
  provider   TEXT NOT NULL DEFAULT '',
  reference  TEXT NOT NULL DEFAULT '',
  starts_at  TEXT,
  ends_at    TEXT,
  details    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_items (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  stop_id    TEXT REFERENCES stops (id) ON DELETE SET NULL,
  category   TEXT NOT NULL DEFAULT 'other',
  label      TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'EUR',
  paid       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packing_items (
  id         TEXT PRIMARY KEY,
  trip_id    TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Other',
  packed     INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Photo files live in the R2 bucket as "<trip id>/<photo id>.jpg" (+ "_t.jpg" thumbnail).
CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  stop_id     TEXT REFERENCES stops (id) ON DELETE SET NULL,
  uploaded_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path        TEXT NOT NULL UNIQUE,
  thumb_path  TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  taken_at    TEXT,
  lat         REAL,
  lng         REAL,
  caption     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- Wishlist: private to its owner.
CREATE TABLE IF NOT EXISTS wishlist (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  place      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  links      TEXT NOT NULL DEFAULT '[]',
  image_url  TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'manual',
  source_id  TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, source_id)
);

CREATE INDEX IF NOT EXISTS sessions_user_idx  ON sessions (user_id);
CREATE INDEX IF NOT EXISTS trips_owner_idx    ON trips (owner_id);
CREATE INDEX IF NOT EXISTS members_user_idx   ON trip_members (user_id);
CREATE INDEX IF NOT EXISTS stops_trip_idx     ON stops (trip_id, day, position);
CREATE INDEX IF NOT EXISTS bookings_trip_idx  ON bookings (trip_id);
CREATE INDEX IF NOT EXISTS budget_trip_idx    ON budget_items (trip_id);
CREATE INDEX IF NOT EXISTS packing_trip_idx   ON packing_items (trip_id);
CREATE INDEX IF NOT EXISTS photos_trip_idx    ON photos (trip_id);
CREATE INDEX IF NOT EXISTS photos_stop_idx    ON photos (stop_id);
CREATE INDEX IF NOT EXISTS wishlist_owner_idx ON wishlist (owner_id);
