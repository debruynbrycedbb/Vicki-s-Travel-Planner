// Trip tabs: bookings, budget, packing list and people.
import { db } from '../db.js?v=1';
import { h, icon, attempt, toast, openDialog, confirmDialog, field, input, textarea, select, emptyState, fmtDateTime, money, initials } from '../ui.js?v=1';
import { currencySelect } from './trips.js?v=1';

// ---------- Bookings ----------
const BOOKING_KINDS = { flight: 'Flight', stay: 'Stay', train: 'Train', bus: 'Bus', car: 'Car hire', ferry: 'Ferry', activity: 'Activity or tickets', other: 'Other' };

export async function renderBookings(ctx, root) {
  const { trip, stops, isOwner } = ctx;
  const rows = await db.list('bookings', { trip_id: trip.id }, [['starts_at', true], ['created_at', true]]);
  root.append(h('div', { class: 'section-head' },
    h('p', { class: 'muted small' }, isOwner ? 'Flights, stays and tickets, with their confirmation numbers.' : 'Flights, stays and tickets for this trip.'),
    isOwner ? h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => bookingDialog(ctx) }, icon('plus', 15), 'Add booking') : null));
  if (!rows.length) { root.append(emptyState('No bookings yet', isOwner ? 'Add a flight, hotel or ticket so everything is in one place.' : null)); return; }
  root.append(h('ul', { class: 'cards' }, rows.map((b) => {
    const stop = stops.find((s) => s.id === b.stop_id);
    return h('li', { class: 'card booking' },
      h('p', { class: 'eyebrow' }, BOOKING_KINDS[b.kind]),
      h('h3', { class: 'card-title' }, b.title),
      b.provider ? h('p', { class: 'muted small' }, b.provider) : null,
      b.starts_at ? h('p', { class: 'small' }, fmtDateTime(b.starts_at), b.ends_at ? ` → ${fmtDateTime(b.ends_at)}` : '') : null,
      b.reference ? h('p', { class: 'ref' }, h('span', { class: 'mono' }, b.reference),
        h('button', { class: 'icon-btn icon-btn-small', type: 'button', 'aria-label': 'Copy confirmation number', onclick: () => navigator.clipboard?.writeText(b.reference).then(() => toast('Copied')) }, icon('copy', 15))) : null,
      b.details ? h('p', { class: 'notes small' }, b.details) : null,
      stop ? h('a', { class: 'small', href: `#/trip/${trip.id}/stop/${stop.id}` }, icon('pin', 13), stop.name) : null,
      isOwner ? h('div', { class: 'card-actions' },
        h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => bookingDialog(ctx, b) }, 'Edit'),
        h('button', { class: 'btn btn-quiet btn-small danger-text', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Delete this booking?', `“${b.title}” will be removed.`, 'Delete booking'))) return;
          if (await attempt(() => db.remove('bookings', b.id), 'Booking deleted') !== undefined) ctx.rerender();
        } }, 'Delete')) : null);
  })));
}

const stopOptions = (stops) => Object.fromEntries([['', 'No stop'], ...stops.map((s) => [s.id, `${s.num ? s.num + '. ' : ''}${s.name}`])]);

function bookingDialog(ctx, b = {}) {
  const kind = select(BOOKING_KINDS, b.kind || 'flight');
  const title = input({ value: b.title || '', maxlength: 160, placeholder: 'e.g. Madrid → Tokyo, or Hotel name' });
  const provider = input({ value: b.provider || '', maxlength: 160, placeholder: 'Airline, hotel, company' });
  const reference = input({ value: b.reference || '', maxlength: 160, placeholder: 'Confirmation number', spellcheck: 'false' });
  const starts = input({ type: 'datetime-local', value: b.starts_at ? b.starts_at.slice(0, 16) : '' });
  const ends = input({ type: 'datetime-local', value: b.ends_at ? b.ends_at.slice(0, 16) : '' });
  const stop = select(stopOptions(ctx.stops), b.stop_id || '');
  const details = textarea({ maxlength: 3000, placeholder: 'Seats, check-in time, address…' });
  details.value = b.details || '';
  openDialog({
    title: b.id ? 'Edit booking' : 'Add booking',
    body: h('div', { class: 'form' },
      h('div', { class: 'form-row' }, field('Type', kind), field('Confirmation number', reference)),
      field('What', title), field('Booked with', provider),
      h('div', { class: 'form-row' }, field('Starts (local time)', starts), field('Ends (local time)', ends)),
      field('Linked stop', stop), field('Details', details)),
    actions: [{ label: 'Cancel' }, { label: b.id ? 'Save changes' : 'Add booking', kind: 'primary', onClick: async () => {
      if (!title.value.trim()) { toast('Say what the booking is.', 'error'); return false; }
      const data = { kind: kind.value, title: title.value.trim(), provider: provider.value.trim(), reference: reference.value.trim(),
        starts_at: starts.value || null, ends_at: ends.value || null, stop_id: stop.value || null, details: details.value.trim() };
      const row = await attempt(() => (b.id ? db.update('bookings', b.id, data) : db.insert('bookings', { ...data, trip_id: ctx.trip.id })), b.id ? 'Changes saved' : 'Booking added');
      if (!row) return false;
      ctx.rerender();
    } }],
  });
}

// ---------- Budget ----------
const CATS = { transport: 'Transport', stay: 'Stays', food: 'Food & drink', activities: 'Activities', shopping: 'Shopping', other: 'Other' };
const rateCache = {};
async function ratesFor(base) {
  if (!rateCache[base]) {
    rateCache[base] = fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => ({ ...(j?.rates || {}), [base]: 1 }))
      .catch(() => ({ [base]: 1 }));
  }
  return rateCache[base];
}

export async function renderBudget(ctx, root) {
  const { trip, stops, isOwner } = ctx;
  const cur = trip.currency || 'EUR';
  const [items, rates] = await Promise.all([db.list('budget_items', { trip_id: trip.id }, [['created_at', true]]), ratesFor(cur)]);
  const conv = (it) => (rates[it.currency] ? it.amount / rates[it.currency] : null);
  const unconverted = items.filter((it) => conv(it) == null);
  const total = items.reduce((a, it) => a + (conv(it) || 0), 0);
  const paid = items.filter((it) => it.paid).reduce((a, it) => a + (conv(it) || 0), 0);
  const byCat = Object.keys(CATS).map((k) => ({ k, sum: items.filter((it) => it.category === k).reduce((a, it) => a + (conv(it) || 0), 0) })).filter((c) => c.sum > 0);
  const max = Math.max(...byCat.map((c) => c.sum), 1);

  root.append(h('p', { class: 'note small' }, isOwner
    ? 'Only you can see the budget, plus anyone you allow under People.'
    : 'The planner has shared this budget with you. It’s view only.'));
  root.append(h('div', { class: 'budget-summary' },
    h('div', {}, h('p', { class: 'eyebrow' }, 'Total'), h('p', { class: 'big-number' }, money(total, cur))),
    h('div', {}, h('p', { class: 'eyebrow' }, 'Paid'), h('p', { class: 'mid-number' }, money(paid, cur))),
    h('div', {}, h('p', { class: 'eyebrow' }, 'Still to pay'), h('p', { class: 'mid-number' }, money(total - paid, cur)))));
  if (byCat.length) root.append(h('ul', { class: 'bars', 'aria-label': 'Spending by category' }, byCat.map((c) =>
    h('li', {}, h('span', { class: 'bar-label' }, CATS[c.k]), h('span', { class: 'bar' }, h('span', { style: `width:${(c.sum / max) * 100}%` })), h('span', { class: 'bar-value mono' }, money(c.sum, cur))))));
  if (unconverted.length) root.append(h('p', { class: 'muted small' }, `${unconverted.length} item(s) in a currency that can’t be converted aren’t in the totals.`));
  if (items.some((it) => it.currency !== cur)) root.append(h('p', { class: 'muted small' }, 'Other currencies converted at today’s European Central Bank rates.'));

  root.append(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Costs'),
    isOwner ? h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => budgetDialog(ctx) }, icon('plus', 15), 'Add cost') : null));
  if (!items.length) { root.append(emptyState('No costs yet', isOwner ? 'Add flights, stays and spending money to see the total.' : null)); return; }
  root.append(h('ul', { class: 'cost-list' }, items.map((it) => {
    const stop = stops.find((s) => s.id === it.stop_id);
    const box = h('input', { type: 'checkbox', checked: it.paid, disabled: !isOwner, 'aria-label': `Paid: ${it.label}`, onchange: async (e) => {
      await attempt(() => db.update('budget_items', it.id, { paid: e.target.checked }));
      ctx.rerender();
    } });
    return h('li', { class: 'cost' },
      h('label', { class: 'paid-box', title: 'Paid' }, box, h('span', { class: 'sr-only' }, 'Paid')),
      h('div', { class: 'cost-main' },
        h('p', { class: 'cost-label' }, it.label),
        h('p', { class: 'muted small' }, CATS[it.category], stop ? ` · ${stop.name}` : '', it.paid ? ' · paid' : '')),
      h('div', { class: 'cost-amount' },
        h('p', { class: 'mono' }, money(it.amount, it.currency)),
        it.currency !== cur && conv(it) != null ? h('p', { class: 'muted small mono' }, `≈ ${money(conv(it), cur)}`) : null),
      isOwner ? h('div', { class: 'row-actions' },
        h('button', { class: 'icon-btn icon-btn-small', type: 'button', 'aria-label': `Edit ${it.label}`, onclick: () => budgetDialog(ctx, it) }, icon('edit', 15)),
        h('button', { class: 'icon-btn icon-btn-small', type: 'button', 'aria-label': `Delete ${it.label}`, onclick: async () => {
          if (!(await confirmDialog('Delete this cost?', `“${it.label}” will be removed from the budget.`, 'Delete cost'))) return;
          if (await attempt(() => db.remove('budget_items', it.id), 'Cost deleted') !== undefined) ctx.rerender();
        } }, icon('trash', 15))) : null);
  })));
}

function budgetDialog(ctx, it = {}) {
  const label = input({ value: it.label || '', maxlength: 160, placeholder: 'e.g. Flights, Hotel, Spending money' });
  const amount = input({ type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: it.amount ?? '' });
  const currency = currencySelect(it.currency || ctx.trip.currency || 'EUR');
  const category = select(CATS, it.category || 'other');
  const stop = select(stopOptions(ctx.stops), it.stop_id || '');
  const paid = h('input', { type: 'checkbox', checked: !!it.paid });
  openDialog({
    title: it.id ? 'Edit cost' : 'Add cost',
    body: h('div', { class: 'form' },
      field('What', label),
      h('div', { class: 'form-row' }, field('Amount', amount), field('Currency', currency)),
      h('div', { class: 'form-row' }, field('Category', category), field('Linked stop', stop)),
      h('label', { class: 'check' }, paid, 'Already paid')),
    actions: [{ label: 'Cancel' }, { label: it.id ? 'Save changes' : 'Add cost', kind: 'primary', onClick: async () => {
      const n = parseFloat(String(amount.value).replace(',', '.'));
      if (!label.value.trim()) { toast('Say what the cost is for.', 'error'); return false; }
      if (!(n >= 0)) { toast('Enter an amount.', 'error'); return false; }
      const data = { label: label.value.trim(), amount: Math.round(n * 100) / 100, currency: currency.value, category: category.value, stop_id: stop.value || null, paid: paid.checked };
      const row = await attempt(() => (it.id ? db.update('budget_items', it.id, data) : db.insert('budget_items', { ...data, trip_id: ctx.trip.id })), it.id ? 'Changes saved' : 'Cost added');
      if (!row) return false;
      ctx.rerender();
    } }],
  });
}

// ---------- Packing ----------
const PACK_CATS = ['Documents', 'Clothes', 'Toiletries', 'Health', 'Tech', 'Other'];
const TEMPLATES = {
  'Essentials': [['Passport or ID', 'Documents'], ['Tickets and booking confirmations', 'Documents'], ['Travel insurance details', 'Documents'], ['Bank cards and some cash', 'Documents'], ['Phone and charger', 'Tech'], ['Plug adapter', 'Tech'], ['Medication', 'Health'], ['Toothbrush and toothpaste', 'Toiletries'], ['Underwear and socks', 'Clothes'], ['Sleepwear', 'Clothes']],
  'Beach': [['Swimwear', 'Clothes'], ['Sun cream', 'Toiletries'], ['Sunglasses', 'Other'], ['Hat', 'Clothes'], ['Sandals', 'Clothes'], ['Beach towel', 'Other'], ['After-sun', 'Toiletries']],
  'City break': [['Comfortable walking shoes', 'Clothes'], ['Day bag', 'Other'], ['Power bank', 'Tech'], ['Light jacket', 'Clothes'], ['Reusable water bottle', 'Other']],
  'Cold weather': [['Warm coat', 'Clothes'], ['Gloves', 'Clothes'], ['Scarf', 'Clothes'], ['Warm hat', 'Clothes'], ['Thermal layers', 'Clothes'], ['Lip balm', 'Toiletries']],
  'Hiking': [['Walking boots', 'Clothes'], ['Rain jacket', 'Clothes'], ['Backpack', 'Other'], ['Water bottle', 'Other'], ['First-aid kit', 'Health'], ['Snacks', 'Other'], ['Offline maps downloaded', 'Tech']],
};

export async function renderPacking(ctx, root) {
  const { trip, isOwner } = ctx;
  const items = await db.list('packing_items', { trip_id: trip.id }, [['position', true], ['created_at', true]]);
  const done = items.filter((i) => i.packed).length;
  const cats = [...new Set([...PACK_CATS, ...items.map((i) => i.category)])];

  root.append(h('div', { class: 'progress', role: 'img', 'aria-label': `${done} of ${items.length} packed` },
    h('p', { class: 'small' }, h('strong', {}, `${done} of ${items.length}`), ' packed'),
    h('span', { class: 'bar' }, h('span', { style: `width:${items.length ? (done / items.length) * 100 : 0}%` }))));

  if (isOwner) {
    const label = input({ placeholder: 'Add an item', maxlength: 160, 'aria-label': 'Item' });
    const cat = h('select', { class: 'input', 'aria-label': 'Category' }, cats.map((c) => h('option', { value: c }, c)));
    root.append(h('form', { class: 'add-stop-row', onsubmit: async (e) => {
      e.preventDefault();
      if (!label.value.trim()) return;
      if (await attempt(() => db.insert('packing_items', { trip_id: trip.id, label: label.value.trim(), category: cat.value, position: items.length }))) ctx.rerender();
    } }, label, cat, h('button', { class: 'btn', type: 'submit' }, 'Add')));
    root.append(h('div', { class: 'chips', 'aria-label': 'Start from a list' },
      h('span', { class: 'muted small' }, 'Add a ready-made list:'),
      Object.keys(TEMPLATES).map((name) => h('button', { class: 'chip', type: 'button', onclick: async () => {
        const have = new Set(items.map((i) => i.label.toLowerCase()));
        const rows = TEMPLATES[name].filter(([l]) => !have.has(l.toLowerCase())).map(([l, c], n) => ({ trip_id: trip.id, label: l, category: c, position: items.length + n }));
        if (!rows.length) { toast('Those items are already on the list.'); return; }
        if (await attempt(() => db.insert('packing_items', rows), `${rows.length} items added`)) ctx.rerender();
      } }, icon('plus', 13), name))));
  }

  if (!items.length) { root.append(emptyState('Nothing on the list yet', isOwner ? 'Add items one by one, or start from a ready-made list.' : null)); return; }
  for (const c of cats) {
    const group = items.filter((i) => i.category === c);
    if (!group.length) continue;
    root.append(h('section', { class: 'section' },
      h('h3', { class: 'group-title' }, c, h('span', { class: 'muted small' }, ` · ${group.filter((i) => i.packed).length}/${group.length}`)),
      h('ul', { class: 'pack-list' }, group.map((i) => h('li', { class: `pack${i.packed ? ' is-packed' : ''}` },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: i.packed, disabled: !isOwner, onchange: async (e) => {
            await attempt(() => db.update('packing_items', i.id, { packed: e.target.checked }));
            ctx.rerender();
          } }),
          h('span', {}, i.label)),
        isOwner ? h('button', { class: 'icon-btn icon-btn-small', type: 'button', 'aria-label': `Remove ${i.label}`, onclick: async () => {
          if (await attempt(() => db.remove('packing_items', i.id)) !== undefined) ctx.rerender();
        } }, icon('close', 14)) : null)))));
  }
}

// ---------- People (planner only) ----------
export async function renderPeople(ctx, root) {
  const { trip, profiles, me } = ctx;
  const others = profiles.filter((p) => p.id !== me.id);
  root.append(h('p', { class: 'note small' }, 'People you invite can see this trip and add their own photos. They can’t change anything else. Turn on “Can see budget” to share the budget with them.'));
  if (!others.length) { root.append(emptyState('Nobody else has an account yet', 'Share the site address and the family code; once they’ve signed up, they appear here.')); return; }
  root.append(h('ul', { class: 'people' }, others.map((p) => {
    const m = trip.members.find((x) => x.user_id === p.id);
    const invited = h('input', { type: 'checkbox', role: 'switch', checked: !!m, onchange: async (e) => {
      const ok = e.target.checked
        ? await attempt(() => db.insert('trip_members', { trip_id: trip.id, user_id: p.id, can_see_budget: false }), `${p.display_name} invited`)
        : await attempt(() => db.removeMember(trip.id, p.id), `${p.display_name} removed`);
      if (ok === undefined || ok === null) e.target.checked = !e.target.checked;
      ctx.rerender();
    } });
    const budget = h('input', { type: 'checkbox', checked: !!m?.can_see_budget, disabled: !m, onchange: async (e) => {
      if (await attempt(() => db.updateMember(trip.id, p.id, { can_see_budget: e.target.checked }), e.target.checked ? 'Budget shared' : 'Budget hidden') === undefined) e.target.checked = !e.target.checked;
    } });
    return h('li', { class: 'person' },
      h('span', { class: 'avatar avatar-small', 'aria-hidden': 'true' }, initials(p.display_name)),
      h('span', { class: 'person-name' }, p.display_name),
      h('label', { class: 'switch' }, invited, h('span', {}, 'Invited')),
      h('label', { class: `check small${m ? '' : ' is-disabled'}` }, budget, 'Can see budget'));
  })));
}
