// Adding photos: resize in the browser (which also strips the file's metadata),
// read when and where each was taken, and suggest the stop it belongs to.
import { db } from './db.js?v=1';
import { CONFIG } from './config.js?v=1';
import { h, icon, openDialog, toast, dayLabel, daysBetween, toISO } from './ui.js?v=1';
import { distanceKm } from './places.js?v=1';

let exifr;
async function readExif(file) {
  try {
    exifr ||= (await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs')).default;
    const tags = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] });
    const date = tags?.DateTimeOriginal || tags?.CreateDate || null;
    return {
      taken: date instanceof Date && !isNaN(date) ? date : null,
      lat: Number.isFinite(tags?.latitude) ? tags.latitude : null,
      lng: Number.isFinite(tags?.longitude) ? tags.longitude : null,
    };
  } catch { return { taken: null, lat: null, lng: null }; }
}

async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
function toJpeg(src, maxEdge, quality) {
  const w0 = src.width, h0 = src.height;
  const k = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.round(w0 * k), hgt = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, hgt);
  return new Promise((res) => c.toBlob((b) => res({ blob: b, width: w, height: hgt }), 'image/jpeg', quality));
}

// Local "YYYY-MM-DDTHH:MM:SS" (photo clocks have no time zone).
const localStamp = (d) => `${toISO(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

export async function processFile(file) {
  const [exif, img] = await Promise.all([readExif(file), decode(file)]);
  const full = await toJpeg(img, CONFIG.PHOTO_MAX_EDGE, 0.84);
  const thumb = await toJpeg(img, CONFIG.THUMB_MAX_EDGE, 0.78);
  img.close?.();
  return {
    full: full.blob, thumb: thumb.blob, width: full.width, height: full.height,
    taken_at: exif.taken ? localStamp(exif.taken) : null,
    lat: exif.lat, lng: exif.lng,
  };
}

// Best guess for which stop a photo belongs to.
export function suggestStop(photo, trip, stops) {
  const placed = stops.filter((s) => s.lat != null);
  const near = (list, maxKm) => {
    let best = null, bestD = Infinity;
    for (const s of list) { const d = distanceKm(photo, s); if (d < bestD) { best = s; bestD = d; } }
    return bestD <= maxKm ? best : null;
  };
  const hasGps = photo.lat != null && photo.lng != null;
  let dayStops = [];
  if (photo.taken_at && trip.start_date) {
    const day = daysBetween(trip.start_date, photo.taken_at.slice(0, 10)) + 1;
    dayStops = placed.filter((s) => s.day === day);
  }
  if (hasGps) {
    const sameDay = near(dayStops, 40);
    if (sameDay) return sameDay.id;
    const close = near(placed, 3);
    if (close) return close.id;
  }
  if (dayStops.length) {
    const t = photo.taken_at.slice(11, 16);
    const timed = dayStops.filter((s) => s.start_time && s.start_time.slice(0, 5) <= t);
    if (timed.length) return timed[timed.length - 1].id;
    if (!hasGps) return dayStops[0].id;
  }
  if (hasGps) { const loose = near(placed, 25); if (loose) return loose.id; }
  return '';
}

// opts.stopId: adding to one stop (still changeable per photo).
export function openUploader(ctx, { stopId = null } = {}) {
  const { trip, stops } = ctx;
  const items = [];
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif', multiple: true, class: 'sr-only', id: 'photo-files' });
  const drop = h('label', { class: 'dropzone', for: 'photo-files' },
    icon('upload', 26),
    h('span', { class: 'dropzone-title' }, 'Choose photos or drop them here'),
    h('span', { class: 'muted small' }, stopId ? 'They’ll be added to this stop.' : 'Each photo is placed on a stop using when and where it was taken.'));
  const status = h('p', { class: 'muted small', role: 'status' });
  const grid = h('ul', { class: 'upload-grid' });
  const options = [['', 'Not matched to a stop'], ...stops.map((s) => [s.id, `${s.num ? s.num + '. ' : ''}${s.name}${s.day ? ' · ' + dayLabel(trip, s.day).split(' · ')[0] : ''}`])];

  const addFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    let n = 0;
    for (const file of list) {
      status.textContent = `Reading photo ${++n} of ${list.length}…`;
      const li = h('li', { class: 'upload-item is-loading' }, h('span', { class: 'upload-thumb' }));
      grid.append(li);
      try {
        const p = await processFile(file);
        p.stop_id = stopId || suggestStop(p, trip, stops);
        p.name = file.name;
        items.push(p);
        const sel = h('select', { class: 'input input-small', 'aria-label': `Stop for ${file.name}` }, options.map(([v, l]) => h('option', { value: v }, l)));
        sel.value = p.stop_id;
        sel.addEventListener('change', () => { p.stop_id = sel.value; });
        const thumbUrl = URL.createObjectURL(p.thumb);
        li.classList.remove('is-loading');
        li.replaceChildren(
          h('img', { class: 'upload-thumb', src: thumbUrl, alt: '' }),
          h('button', { class: 'icon-btn icon-btn-small upload-remove', type: 'button', 'aria-label': `Remove ${file.name}`, onclick: () => { items.splice(items.indexOf(p), 1); li.remove(); refresh(); } }, icon('close', 14)),
          h('span', { class: 'upload-meta small muted' }, p.taken_at ? p.taken_at.slice(0, 16).replace('T', ' ') : 'No date', p.lat != null ? ' · GPS' : ''),
          sel);
      } catch (e) {
        console.warn(e);
        li.classList.remove('is-loading');
        li.classList.add('is-error');
        li.replaceChildren(h('span', { class: 'small' }, `${file.name}: this browser can’t read it. Try exporting it as JPEG.`));
      }
    }
    refresh();
  };
  const refresh = () => {
    const matched = items.filter((i) => i.stop_id).length;
    status.textContent = items.length ? `${items.length} photos ready · ${matched} placed on a stop${items.length - matched ? `, ${items.length - matched} unsorted` : ''}. Check the stops, then save.` : '';
    saveBtn.disabled = !items.length;
    saveBtn.textContent = items.length ? `Save ${items.length} photos` : 'Save photos';
  };
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); });

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true });
  let busy = false;
  const { close, dlg } = openDialog({
    title: stopId ? `Add photos to ${stops.find((s) => s.id === stopId)?.name || 'this stop'}` : `Add photos to ${trip.title}`,
    wide: true,
    body: h('div', { class: 'uploader' }, fileInput, drop, status, grid),
    onClose: () => { if (busy) toast('Upload stopped. Photos saved so far are kept.', 'error'); },
  });
  dlg.querySelector('.dialog-body').after(h('div', { class: 'dialog-actions' },
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => close() }, 'Cancel'), saveBtn));
  refresh();

  saveBtn.addEventListener('click', async () => {
    busy = true; saveBtn.disabled = true;
    let ok = 0, failed = 0;
    for (const [i, p] of items.entries()) {
      if (!dlg.open) break;
      status.textContent = `Saving photo ${i + 1} of ${items.length}…`;
      try {
        await db.uploadPhoto(trip.id, { full: p.full, thumb: p.thumb }, {
          stop_id: p.stop_id || null, width: p.width, height: p.height, taken_at: p.taken_at, lat: p.lat, lng: p.lng,
        });
        ok++;
      } catch (e) { console.warn(e); failed++; if (failed === 1) toast(e.message, 'error'); }
    }
    busy = false;
    if (dlg.open) close();
    toast(failed ? `${ok} photos saved, ${failed} didn’t save` : `${ok} photos saved`, failed ? 'error' : 'ok');
    ctx.rerender();
  });
}
