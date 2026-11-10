// Account menu: name, password, backup, Travel World Map import, sign out.
import { db, loadTrips } from './db.js?v=2';
import { h, icon, openDialog, field, input, select, toast, attempt, todayISO, initials } from './ui.js?v=2';

export function openAccount(app) {
  const name = input({ value: app.me.display_name, maxlength: 60 });
  const current = input({ type: 'password', autocomplete: 'current-password' });
  const pw = input({ type: 'password', autocomplete: 'new-password' });
  const row = (title, text, button) => h('div', { class: 'acct-row' }, h('div', {}, h('p', { class: 'acct-title' }, title), h('p', { class: 'muted small' }, text)), button);

  const { close } = openDialog({
    title: 'Your account',
    body: h('div', { class: 'form' },
      h('p', { class: 'muted small' }, db.demo ? 'Demo mode · saved in this browser only' : `Signed in as ${app.me.email}`),
      h('form', { class: 'acct-inline', onsubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim()) return;
        if (await attempt(() => db.updateName(name.value.trim()), 'Name saved')) { app.me.display_name = name.value.trim(); document.querySelector('.avatar').textContent = initials(name.value.trim()); }
      } }, field('Your name', name), h('button', { class: 'btn', type: 'submit' }, 'Save name')),
      db.demo ? null : h('form', { class: 'form acct-block', onsubmit: async (e) => {
        e.preventDefault();
        if (pw.value.length < 8) { toast('Use at least 8 characters.', 'error'); return; }
        if (await attempt(() => db.setPassword(current.value, pw.value), 'Password changed')) { current.value = ''; pw.value = ''; }
      } }, h('p', { class: 'acct-title' }, 'Change password'),
        h('div', { class: 'form-row' }, field('Current password', current), field('New password', pw, 'At least 8 characters.')),
        h('button', { class: 'btn', type: 'submit' }, 'Change password')),
      app.me.is_admin ? row('Reset someone’s password', 'For a family member who forgot theirs. You choose a temporary password and tell them; they can change it after signing in.',
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); resetSomeone(app); } }, 'Reset')) : null,
      h('hr'),
      row('Download a backup', 'Every trip you planned, with stops, bookings, budget, packing list and photo details, plus your wishlist, as one JSON file. Photo files aren’t included.',
        h('button', { class: 'btn', type: 'button', onclick: () => downloadBackup() }, icon('upload', 15), 'Download')),
      row('Import Travel World Map places', 'Adds the 8 places from Bryce’s Travel World Map to your wishlist. Places already imported are skipped.',
        h('button', { class: 'btn', type: 'button', onclick: async () => { await importTravelMap(); close(); app.go('wishlist'); } }, 'Import')),
      db.demo ? row('Reset the demo', 'Delete everything added in this browser and start again with the sample trips.',
        h('button', { class: 'btn btn-quiet danger-text', type: 'button', onclick: () => { db.resetDemo(); location.reload(); } }, 'Reset')) : null,
      h('hr'),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => { await db.signOut(); location.hash = ''; location.reload(); } }, 'Sign out')),
  });
}

async function downloadBackup() {
  await attempt(async () => {
    const trips = (await loadTrips()).filter((t) => t.role === 'owner');
    const ids = trips.map((t) => t.id);
    const strip = ({ role, canSeeBudget, members, ...rest }) => rest;
    const [stops, bookings, budget, packing, photos, wishlist] = await Promise.all([
      db.list('stops', { trip_id: ids }, [['day', true], ['position', true]]),
      db.list('bookings', { trip_id: ids }),
      db.list('budget_items', { trip_id: ids }),
      db.list('packing_items', { trip_id: ids }),
      db.list('photos', { trip_id: ids }),
      db.list('wishlist', {}),
    ]);
    const data = {
      app: "Vicki's Travel Planner",
      exported_at: new Date().toISOString(),
      exported_by: db.me.display_name,
      note: 'Photo files are not included; "path" is where each one is stored.',
      trips: trips.map((t) => ({
        ...strip(t),
        companions: t.members.map((m) => ({ user_id: m.user_id, can_see_budget: m.can_see_budget })),
        stops: stops.filter((x) => x.trip_id === t.id),
        bookings: bookings.filter((x) => x.trip_id === t.id),
        budget: budget.filter((x) => x.trip_id === t.id),
        packing: packing.filter((x) => x.trip_id === t.id),
        photos: photos.filter((x) => x.trip_id === t.id),
      })),
      wishlist,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `vickis-travel-planner-backup-${todayISO()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'Backup downloaded');
}

async function importTravelMap() {
  await attempt(async () => {
    const r = await fetch('assets/import/travel-world-map.json');
    if (!r.ok) throw new Error('The import file is missing.');
    const { places } = await r.json();
    const rows = places.map((p) => ({ ...p, source: 'travel-world-map' }));
    const added = await db.upsertWishlist(rows);
    toast(added.length ? `${added.length} places added to your wishlist` : 'Those places are already on your wishlist');
  });
}

async function resetSomeone(app) {
  const people = ((await attempt(() => db.listProfiles())) || []).filter((p) => p.id !== app.me.id);
  if (!people.length) { toast('Nobody else has an account yet.'); return; }
  const who = select(Object.fromEntries(people.map((p) => [p.id, p.display_name])), people[0].id);
  const pw = input({ autocomplete: 'off', spellcheck: 'false', value: tempPassword() });
  openDialog({
    title: 'Reset someone’s password',
    body: h('div', { class: 'form' },
      field('Person', who),
      field('Temporary password', pw, 'At least 8 characters. They’ll be signed out everywhere and can sign in with this.')),
    actions: [{ label: 'Cancel' }, { label: 'Set password', kind: 'primary', onClick: async () => {
      if (pw.value.length < 8) { toast('Use at least 8 characters.', 'error'); return false; }
      const name = people.find((p) => p.id === who.value)?.display_name;
      if (!(await attempt(() => db.adminResetPassword(who.value, pw.value), `Password reset for ${name}`))) return false;
    } }],
  });
}

function tempPassword() {
  const words = 'map,trail,harbour,olive,summit,lagoon,compass,meadow,ferry,canyon,island,orchard'.split(',');
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${words[r[0] % words.length]}-${words[r[1] % words.length]}-${100 + (r[2] % 900)}`;
}
