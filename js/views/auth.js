// Signed-out screen: sign in, create an account (with the family code), reset a password.
import { h, field, input, openDialog, brandMark } from '../ui.js?v=2';
import { CONFIG } from '../config.js?v=2';
import { getMap } from '../map.js?v=2';

function spinGlobe() {
  const map = getMap();
  let on = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = () => {
    if (!on || !document.body.classList.contains('signed-out')) return;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng + 6, c.lat], duration: 1000, easing: (t) => t });
  };
  map.on('moveend', step);
  map.on('mousedown', () => { on = false; });
  map.on('touchstart', () => { on = false; });
  map.once('idle', step);
}

export function renderAuth(db, done) {
  spinGlobe();
  let mode = 'signin';
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const card = h('section', { class: 'auth-card', 'aria-labelledby': 'auth-title' });

  const tabs = h('div', { class: 'seg auth-tabs', role: 'tablist' },
    ['signin', 'signup'].map((m) => h('button', { type: 'button', role: 'tab', class: 'seg-btn', dataset: { m },
      onclick: () => { mode = m; draw(); } }, m === 'signin' ? 'Sign in' : 'Create account')));

  function draw() {
    msg.textContent = '';
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === mode)));
    const name = input({ name: 'name', autocomplete: 'name', required: true, maxlength: 60 });
    const email = input({ type: 'email', name: 'email', autocomplete: 'email', required: true });
    const password = input({ type: 'password', name: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minlength: mode === 'signup' ? 8 : null });
    const code = input({ name: 'code', autocomplete: 'off', required: true, spellcheck: 'false' });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, mode === 'signup' ? 'Create account' : 'Sign in');

    const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true; msg.textContent = '';
      try {
        if (mode === 'signup') await db.signUp({ name: name.value.trim(), email: email.value.trim(), password: password.value, code: code.value.trim() });
        else await db.signIn({ email: email.value.trim(), password: password.value });
        done();
      } catch (err) { msg.textContent = err.message; submit.disabled = false; }
    } },
      mode === 'signup' ? field('Your name', name, 'This is how the family will see you.') : null,
      field('Email', email),
      field('Password', password, mode === 'signup' ? 'At least 8 characters.' : null),
      mode === 'signup' ? field('Family code', code, 'Ask Vicki or Bryce for it.') : null,
      msg,
      submit,
      mode === 'signin' && !db.demo ? h('button', { type: 'button', class: 'link-btn', onclick: forgot }, 'Forgot your password?') : null);

    body.replaceChildren(form);
  }

  const body = h('div');
  card.append(
    h('div', { class: 'auth-brand' }, h('span', { class: 'brand-mark' }, brandMark()), h('span', { class: 'eyebrow' }, 'Family & friends')),
    h('h1', { id: 'auth-title', class: 'auth-title' }, 'Vicki’s', h('br'), h('em', {}, 'Travel Planner')),
    h('p', { class: 'auth-lede' }, 'Plan the trip. Keep the trip. Stops, bookings and packing before you go; everyone’s photos, sorted by place, when you’re back.'),
    db.demo
      ? h('div', { class: 'form' },
          h('p', { class: 'note' }, 'Demo mode: the database isn’t connected yet. Anything you add is saved in this browser only.'),
          h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: async () => { await db.signIn({}); done(); } }, 'Open the demo'))
      : h('div', { class: 'auth-forms' }, tabs, body),
  );
  document.body.append(h('div', { class: 'auth-wrap' }, card));
  if (!db.demo) draw();
  // Keep the globe in the open space beside (or above, on phones) the card.
  const pad = () => {
    const r = card.getBoundingClientRect();
    getMap().setPadding(window.innerWidth < 760 ? { top: 0, bottom: window.innerHeight - r.top, left: 0, right: 0 } : { left: r.right, top: 0, bottom: 0, right: 0 });
  };
  pad();
  window.addEventListener('resize', pad);
}

function forgot() {
  openDialog({
    title: 'Forgot your password?',
    body: h('div', { class: 'form' },
      h('p', {}, `Ask ${CONFIG.ADMIN_NAME} to set a temporary password for you.`),
      h('p', { class: 'muted' }, 'Sign in with it, then choose your own password under your initials (top right) → Change password.')),
    actions: [{ label: 'OK', kind: 'primary' }],
  });
}
