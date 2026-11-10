# Vicki’s Travel Planner

A holiday planner for family and family friends. Trips sit on a natural-colour world map:
plan stops day by day, keep bookings, a budget and a packing list, then add everyone’s photos
after the trip. Each photo is placed on the stop where it was taken.

Live address (once GitHub Pages is on): https://debruynbrycedbb.github.io/Vicki-s-Travel-Planner/

## Features
- **Accounts:** sign up with name, email, password and the **family code**; sign in with email + password. Forgotten password: an admin (the emails in `ADMIN_EMAILS`) sets a temporary one under **Account → Reset someone’s password**.
- **Trips:** Upcoming and Past lists, countdown stamps, cover photos. Anyone with an account can plan trips.
- **Map:** MapTiler’s natural Topo style (blue sea, shaded relief) with a **Map / Satellite** switch; globe view when zoomed out. Right-click anywhere (desktop) to add that spot to a trip or the wishlist.
- **Itinerary:** stops per day, drag to reorder or move between days, coloured route lines per day. Add a stop by searching, pasting a Google Maps / OpenStreetMap link, or picking a spot on the map.
- **Companions:** the planner invites people under **People**. They see the trip but can’t change it; they *can* add their own photos (and delete only their own).
- **Bookings:** flights, stays, tickets with confirmation numbers (copy button).
- **Budget:** only the planner sees it, plus companions given **Can see budget**. Other currencies are converted with European Central Bank rates (Frankfurter).
- **Packing list:** checklist by category, with ready-made lists (Essentials, Beach, City break, Cold weather, Hiking).
- **Photos:** add photos to a stop, or **Add trip photos** to drop a whole batch: each is matched to a stop by time and GPS, and you can change any before saving. Photos are resized in the browser to 2,048 px (which also strips the file’s hidden metadata) before upload.
- **Photos page:** every photo from every trip, filter by trip or year, full-screen viewer.
- **Wishlist:** gold pins for places you’d like to go one day (private to you); **Add to a trip** moves one into a trip.
- **Play the trip:** the map flies stop to stop, drawing the route and showing each stop’s photos.
- **Account menu** (your initials, top right): change name/password, **Download a backup** (JSON), **Import Travel World Map places** (the 8 places, copied into `assets/import/`), admin password reset, sign out.
- **Private photos:** photos are only reachable through links the Worker signs for people on that trip; links expire after about 6 hours.

Until the Worker address is in `js/config.js` the site runs in **demo mode** (saved in that browser only). Add `?demo` to the address to force demo mode later.

## One-time setup

### 1. Cloudflare (database, sign-in, photo storage)
Everything is in your Cloudflare account (the same one as Ledgerline), but in its **own** database, bucket and Worker, so the two sites never affect each other. Free plan limits: 100,000 Worker requests a day, 5 GB database, 10 GB photos.

1. **Database.** Cloudflare dashboard → **Storage & databases** → **D1 SQL database** → **Create**. Name: `vickis-travel-planner`. Open it → **Console** tab → paste all of [`worker/schema.sql`](worker/schema.sql) → **Execute**.
2. **Photo bucket.** **R2 object storage** → **Create bucket**. Name: `vickis-travel-planner-photos`, location Automatic. (Cloudflare may ask you to add a card to turn R2 on. You’re only charged above 10 GB of photos.)
3. **Worker.** **Workers & Pages** → **Create** → **Start with Hello World** → name it `vickis-travel-planner-api` → **Deploy**. Then **Edit code**, delete what’s there, paste all of [`worker/worker.js`](worker/worker.js) → **Deploy**.
4. **Connect them.** Open the Worker → **Settings** → **Bindings** → **Add**:
   - **D1 database**: variable name `DB` → `vickis-travel-planner`.
   - **R2 bucket**: variable name `PHOTOS` → `vickis-travel-planner-photos`.
5. **Settings.** Worker → **Settings** → **Variables and Secrets** → **Add** (choose type **Secret** for the first two):
   - `FAMILY_CODE`: the code family members type to make an account (8+ characters).
   - `SIGNING_KEY`: a long random string. Make one in Terminal with `openssl rand -base64 32` and paste the result.
   - `ADMIN_EMAILS` (type Text): your email, the one you’ll sign up with. Add more separated by commas. Admins can reset other people’s passwords.
   - `ALLOWED_ORIGINS` is optional. Leave it out unless the site moves; the Worker already allows `https://debruynbrycedbb.github.io` and `http://localhost:8766`.
6. Copy the Worker’s address (shown on its page, like `https://vickis-travel-planner-api.<your-name>.workers.dev`) into `API_URL` in `js/config.js`. Opening that address in a browser should show `{"ok":true,…}`.

None of the secrets go in this repository. To change the family code later, edit `FAMILY_CODE` in the Worker’s settings; existing accounts keep working.

If sign-in ever fails with “Error 1102” (the Worker used too much processing time), lower `PBKDF2_ITERATIONS` at the top of `worker/worker.js` and deploy again. Existing passwords keep working.

### 2. MapTiler (map tiles and place search)
1. Sign up free at <https://cloud.maptiler.com>.
2. **API Keys** → create a key → under **Allowed HTTP origins** add `debruynbrycedbb.github.io` and `localhost`.
3. Paste the key into `MAPTILER_KEY` in `js/config.js`. (Safe to publish once it’s locked to those origins.)

Without a key the site falls back to OpenFreeMap’s street style and the Satellite button is off.

### 3. GitHub Pages
**Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)` → **Save**.

## Changing the site
- Plain HTML, CSS and JavaScript modules; no build step. Libraries load from jsDelivr at pinned versions: MapLibre GL 5.24.0, exifr 7.1.3, SortableJS 1.15.6.
- **The Worker:** after changing `worker/worker.js`, paste it into the Worker’s **Edit code** page again and **Deploy**. After changing `worker/schema.sql`, run the new parts in the D1 **Console** (existing tables aren’t changed by `CREATE TABLE IF NOT EXISTS`).
- **On every release, bump the cache version** (`?v=1` → `?v=2`) in `index.html` and in every `import` line, all at once:
  ```bash
  grep -rl '?v=1' index.html js | xargs sed -i '' 's/?v=1/?v=2/g'
  ```
- Add `?debug` to the address to expose `window.__vtp` in the browser console.

### Run it on your computer
```bash
python3 -m http.server 8766
```
then open <http://localhost:8766>.

To test with the real Worker code but without Cloudflare, open <http://localhost:8766/local-test.html>. It runs `worker/worker.js` inside the page, with a temporary SQLite database and photo store in that browser. Family code `test-family-code`; the account `admin@test.local` is an admin; add `?reset` to start over.

## Files
- `index.html` · `css/style.css`
- `js/config.js`: keys and settings (publishable only)
- `js/app.js`: start-up, layout, navigation, place search
- `js/db.js` / `js/demo-db.js`: talks to the Worker; the demo store
- `js/map.js`, `js/places.js`: map, pins, routes, search, link parsing
- `js/views/`: sign-in, trips, trip page and tabs, wishlist, photos
- `js/upload.js`: photo resizing and auto-sorting · `js/play.js`: Play the trip · `js/account.js`: backup and import
- `worker/worker.js`: the Cloudflare Worker (sign-in, sessions, who can see and change what, photo upload and signed photo links)
- `worker/schema.sql`: the D1 database tables
- `local-test.html`: runs the Worker in the browser for local testing
- `assets/import/`: the 8 Travel World Map places and their photos
