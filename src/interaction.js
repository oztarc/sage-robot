import * as THREE from 'three';
import { componentOf, componentMeshes } from './robot.js';

const ACCENT = new THREE.Color(0xff9e3d);
const HOVER_INTENSITY = 0.22;
const SELECT_INTENSITY = 0.42;
const GLOW_HOVER_GAIN = 1.35;
const GLOW_SELECT_GAIN = 1.7;
const OPTIC_GAIN = 7;

const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;

class EmissiveLedger {
  constructor() {
    this.base = new Map();
  }

  capture(mat) {
    let entry = this.base.get(mat);
    if (!entry) {
      entry = {
        color: mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000),
        intensity: 'emissiveIntensity' in mat ? mat.emissiveIntensity : 1,
      };
      this.base.set(mat, entry);
    }
    return entry;
  }

  setBaseIntensity(mat, intensity) {
    this.capture(mat).intensity = intensity;
  }

  restore(mat) {
    const entry = this.base.get(mat);
    if (!entry) return;
    mat.emissive?.copy(entry.color);
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = entry.intensity;
  }

  restoreAll() {
    for (const mat of this.base.keys()) this.restore(mat);
  }
}

const asArray = (m) => (Array.isArray(m) ? m : [m]);

export function triangleCount(component) {
  return componentMeshes(component).reduce((sum, mesh) => {
    const g = mesh.geometry;
    if (!g) return sum;
    return sum + Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
  }, 0);
}

export function createInteraction({ stage, rig, canvas, onSelect }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ledger = new EmissiveLedger();

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let hovered = null;
  let selected = null;
  let pointerDown = null;
  let pickPending = false;
  let opticOn = false;

  const opticMaterials = rig.optic?.materials ?? [];
  const opticBase = opticMaterials.map((m) => ledger.capture(m).intensity || 1);

  function paint(component, level) {
    if (!component) return;
    const mats = componentMeshes(component).flatMap((m) => asArray(m.material));
    for (const mat of mats) {
      if (!mat) continue;
      const base = ledger.capture(mat);
      if (level === 0) {
        ledger.restore(mat);
        continue;
      }
      const alreadyGlowing = base.color.getHex() !== 0x000000;
      if (alreadyGlowing) {
        mat.emissiveIntensity = base.intensity * (level === 1 ? GLOW_HOVER_GAIN : GLOW_SELECT_GAIN);
      } else {
        mat.emissive?.copy(ACCENT);
        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = level === 1 ? HOVER_INTENSITY : SELECT_INTENSITY;
        }
      }
    }
  }

  function refresh() {
    ledger.restoreAll();
    if (selected) paint(selected, 2);
    if (hovered && hovered !== selected) paint(hovered, 1);
  }

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pick() {
    raycaster.setFromCamera(pointer, stage.camera);
    const hits = raycaster.intersectObjects(rig.selectable, false);
    return hits.length ? hits[0].object : null;
  }

  function setHovered(hit) {
    const mesh = hit ? componentOf(hit) : null;
    if (mesh === hovered) return;
    if (hovered && hovered !== selected) paint(hovered, 0);
    hovered = mesh;
    if (hovered && hovered !== selected) paint(hovered, 1);
    canvas.style.cursor = hovered ? 'pointer' : '';
  }

  function focusOn(mesh) {
    const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
    if (sphere.radius > 0) stage.flyToSphere(sphere, 2.2);
  }

  function select(hit) {
    const component = hit ? componentOf(hit) : null;
    if (selected === component) {
      if (component) focusOn(component);
      return;
    }
    if (selected) paint(selected, 0);
    selected = component;
    refresh();

    if (component) {
      focusOn(component);
      const names = componentMeshes(component)
        .flatMap((m) => asArray(m.material))
        .filter(Boolean)
        .map((m) => m.name || 'unnamed');
      onSelect?.({
        name: component.name,
        triangles: triangleCount(component),
        materials: [...new Set(names)],
      });
    } else {
      onSelect?.(null);
    }
  }

  function clearSelection({ fly = true } = {}) {
    if (!selected && !fly) return;
    if (selected) paint(selected, 0);
    selected = null;
    refresh();
    onSelect?.(null);
    if (fly) stage.goHome();
  }

  function onPointerMove(event) {
    if (!canHover || pointerDown) return;
    updatePointer(event);
    pickPending = true;
  }

  function onPointerDown(event) {
    pointerDown = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId };
  }

  function onPointerUp(event) {
    const down = pointerDown;
    pointerDown = null;
    if (!down || down.id !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > CLICK_SLOP_PX || performance.now() - down.t > CLICK_MAX_MS) return;

    updatePointer(event);
    stage.cancelFlight();
    const hit = pick();
    if (hit) select(hit);
    else clearSelection();
  }

  function onPointerLeave() {
    setHovered(null);
    pickPending = false;
  }

  function onContextLost(event) {
    event.preventDefault();
    console.warn('[SAGE] WebGL context lost');
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
  canvas.addEventListener('pointerup', onPointerUp, { passive: true });
  canvas.addEventListener('pointercancel', onPointerLeave, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  canvas.addEventListener('webglcontextlost', onContextLost, false);

  return {
    update() {
      if (!pickPending) return;
      pickPending = false;
      setHovered(pick());
    },

    setOptic(on) {
      opticOn = on;
      opticMaterials.forEach((mat, i) => {
        ledger.setBaseIntensity(mat, on ? opticBase[i] * OPTIC_GAIN : opticBase[i]);
      });
      refresh();
      return opticOn;
    },

    setAutoRotate(on) {
      stage.controls.autoRotate = on;
    },

    resetView() {
      clearSelection({ fly: true });
    },

    get selected() {
      return selected;
    },

    hasOptic: opticMaterials.length > 0,

    dispose() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerLeave);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      ledger.restoreAll();
      canvas.style.cursor = '';
      hovered = null;
      selected = null;
    },
  };
}
