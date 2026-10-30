// Scripts injected into application pages. Kept as plain strings so bundling can't alter them.

/**
 * Returns visible form fields with human-readable labels. Each element gets a data-js-id
 * attribute so the engine can target it reliably.
 */
export const EXTRACT_FIELDS = `(() => {
  const visible = (el) => {
    if (el.type === 'file') return true;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[aria-hidden="true"]');
  };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\*+/g, '').trim();
  const textOf = (id) => { const n = id && document.getElementById(id); return n ? n.innerText || n.textContent : ''; };
  let counter = Number(document.body.dataset.jsCounter || 0);
  const tag = (el) => { if (!el.dataset.jsId) { el.dataset.jsId = 'f' + (++counter); } return '[data-js-id="' + el.dataset.jsId + '"]'; };
  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map(textOf).join(' '); if (clean(t)) return clean(t); }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && clean(l.innerText)) return clean(l.innerText); }
    const wrap = el.closest('label'); if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
    if (aria) return clean(aria);
    // Workday-style containers and generic field wrappers
    const container = el.closest('[data-automation-id^="formField"], .field, .form-group, .application-question, .question, li, .input-wrapper, div');
    if (container) {
      const l = container.querySelector('label, legend, .label, [class*="label"]');
      if (l && clean(l.innerText) && !l.contains(el)) return clean(l.innerText);
    }
    let p = el.previousElementSibling;
    while (p && !clean(p.innerText)) p = p.previousElementSibling;
    if (p) return clean(p.innerText).slice(0, 200);
    return clean(el.getAttribute('placeholder') || el.name || '');
  };
  const out = [];
  const seenRadio = new Set();
  const els = Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"], button[aria-haspopup="listbox"]'));
  for (const el of els) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== 'file') continue;
    if (!visible(el) && type !== 'file') continue;
    const required = el.required || el.getAttribute('aria-required') === 'true' || /\\*/.test((el.closest('label, .field, .form-group, [data-automation-id^="formField"]') || {}).innerText || '');
    if (type === 'radio' || type === 'checkbox') {
      const name = el.name || el.id;
      if (type === 'radio' || document.querySelectorAll('input[type="checkbox"][name="' + CSS.escape(name) + '"]').length > 1) {
        if (seenRadio.has(name)) continue;
        seenRadio.add(name);
        const group = Array.from(document.querySelectorAll('input[name="' + CSS.escape(name) + '"]'));
        const fs = el.closest('fieldset, [role="radiogroup"], [role="group"], .field, .form-group, .application-question');
        const legend = fs && fs.querySelector('legend, label, .label, [class*="label"]');
        const options = group.map((g) => { const l = labelFor(g); return l; });
        group.forEach(tag);
        out.push({ selector: tag(el), group: group.map((g) => '[data-js-id="' + g.dataset.jsId + '"]'), label: clean(legend ? legend.innerText : fs ? fs.innerText.split('\\n')[0] : name), name, type, required, options });
        continue;
      }
      out.push({ selector: tag(el), label: labelFor(el), name: el.name || '', type: 'checkbox', required, options: [] });
      continue;
    }
    if (el.tagName === 'SELECT') {
      out.push({ selector: tag(el), label: labelFor(el), name: el.name || '', type: 'select', required, options: Array.from(el.options).map((o) => clean(o.text)) });
      continue;
    }
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') {
      out.push({ selector: tag(el), label: labelFor(el), name: el.getAttribute('name') || '', type: 'combobox', required, options: [], current: clean(el.innerText || el.value) });
      continue;
    }
    const t = el.tagName === 'TEXTAREA' ? 'textarea' : ['email', 'tel', 'date', 'number', 'url', 'file', 'password'].includes(type) ? type : 'text';
    out.push({ selector: tag(el), label: labelFor(el), name: el.name || '', type: t, required, options: [], placeholder: el.getAttribute('placeholder') || '', current: el.value || '', accept: el.getAttribute('accept') || '' });
  }
  document.body.dataset.jsCounter = String(counter);
  return out;
})()`

/** Finds clickable buttons/links and classifies them. */
export const FIND_BUTTONS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  let counter = Number(document.body.dataset.jsBtn || 0);
  const out = [];
  for (const el of Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], a, [role="button"]'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.disabled) continue;
    const text = clean(el.innerText || el.value || el.getAttribute('aria-label') || '');
    if (!text || text.length > 60) continue;
    if (!el.dataset.jsBtn) el.dataset.jsBtn = 'b' + (++counter);
    out.push({ selector: '[data-js-btn="' + el.dataset.jsBtn + '"]', text, auto: el.getAttribute('data-automation-id') || '', type: el.getAttribute('type') || '', tag: el.tagName });
  }
  document.body.dataset.jsBtn = String(counter);
  return out;
})()`

/** Visible validation errors on the page. */
export const FIND_ERRORS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const sel = '[role="alert"], .error, .errors, .field-error, .invalid-feedback, [class*="error-message"], [data-automation-id="errorMessage"], [aria-invalid="true"]';
  return Array.from(document.querySelectorAll(sel)).map((e) => clean(e.innerText || e.getAttribute('aria-label') || (e.getAttribute('aria-invalid') ? 'Invalid: ' + (e.getAttribute('name') || e.id) : ''))).filter((t) => t && t.length < 300).slice(0, 10);
})()`

export const PAGE_TEXT = `(() => (document.body.innerText || '').slice(0, 20000))()`
