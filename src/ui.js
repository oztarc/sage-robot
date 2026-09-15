const SLIDER_MAX = 1000;

const $ = (sel, root = document) => root.querySelector(sel);
const slot = (name) => document.querySelector(`[data-slot="${name}"]`);

export function createUI(handlers) {
  const input = $('#scrub');
  const boot = $('#boot');
  const pct = slot('pct');
  const bootText = slot('boot');
  const bootBar = slot('bootbar');
  const selection = $('#selection');

  const actions = [...document.querySelectorAll('.btn[data-act]')];
  const toggles = [...document.querySelectorAll('.btn[data-toggle]')];

  const listeners = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    listeners.push(() => el.removeEventListener(type, fn));
  };

  on(input, 'input', () => {
    const v = Number(input.value) / SLIDER_MAX;
    paintScrub(v);
    handlers.onScrub(v);
  });

  for (const b of actions) {
    on(b, 'click', () => {
      if (b.dataset.act === 'assemble') handlers.onAssemble();
      else if (b.dataset.act === 'explode') handlers.onExplode();
      else if (b.dataset.act === 'reset') handlers.onReset();
    });
  }

  for (const b of toggles) {
    on(b, 'click', () => {
      const next = b.getAttribute('aria-pressed') !== 'true';
      const applied = handlers.onToggle(b.dataset.toggle, next);
      b.setAttribute('aria-pressed', String(applied === undefined ? next : applied));
    });
  }

  function paintScrub(v) {
    pct.textContent = String(Math.round(v * 100)).padStart(3, '0');
    for (const b of actions) {
      if (b.dataset.act !== 'assemble' && b.dataset.act !== 'explode') continue;
      const target = b.dataset.act === 'assemble' ? 0 : 1;
      b.setAttribute('aria-pressed', String(Math.abs(v - target) < 0.001));
    }
  }

  paintScrub(0);

  return {
    setValue(v) {
      input.value = String(Math.round(v * SLIDER_MAX));
      paintScrub(v);
    },

    setRow(name, value, warn = false) {
      const el = slot(name);
      if (!el) return;
      el.textContent = value;
      if (warn) el.dataset.warn = '1';
      else delete el.dataset.warn;
    },

    setSelection(info) {
      if (!info) {
        selection.hidden = true;
        return;
      }
      selection.hidden = false;
      slot('sel-name').textContent = info.name;
      slot('sel-tris').textContent = info.triangles.toLocaleString('en-US');
      slot('sel-mats').textContent = info.materials.join(', ') || '—';
    },

    setToggle(name, on) {
      const b = toggles.find((t) => t.dataset.toggle === name);
      b?.setAttribute('aria-pressed', String(on));
    },

    disableToggle(name) {
      const b = toggles.find((t) => t.dataset.toggle === name);
      if (b) b.disabled = true;
    },

    setProgress(ratio, label) {
      if (label) bootText.textContent = label;
      bootBar.style.width = `${Math.round(ratio * 100)}%`;
    },

    setEnabled(on) {
      input.disabled = !on;
      for (const b of [...actions, ...toggles]) b.disabled = !on;
    },

    finishBoot() {
      boot.classList.add('is-done');
      setTimeout(() => boot.setAttribute('hidden', ''), 520);
    },

    fail(message) {
      bootBar.style.width = '100%';
      bootText.dataset.error = '1';
      bootText.textContent = message;
    },

    dispose() {
      for (const off of listeners) off();
      listeners.length = 0;
    },
  };
}
