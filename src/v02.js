import './v02.css';
import * as THREE from 'three';
import { createStage, prefersReducedMotion } from './scene.js';
import { loadRobot, scrub, setWireframe } from './robot.js';
import { createInteraction } from './interaction.js';

const $ = (id) => document.getElementById(id);
const canvas = $('viewport');
const exhibit = $('exhibit');
const svg = $('leaders');
const reduced = prefersReducedMotion();
const mobile = window.matchMedia('(max-width: 900px)');
const partButtons = [...document.querySelectorAll('[data-part]')];
const finishButtons = [...document.querySelectorAll('[data-finish]')];
const viewButtons = [...document.querySelectorAll('[data-view]')];
const descriptions = {
  head_shell: ['Head housing', 'The external head shell and optical face of the SAGE assembly.'],
  neck: ['Neck assembly', 'The connection between the head and torso, with exposed cable routing.'],
  chest_center: ['Torso chassis', 'The central body structure connecting the upper assembly.'],
  upperarm_L: ['Upper arm · L', 'The left arm section between the shoulder and elbow.'],
  upperarm_R: ['Upper arm · R', 'The right arm section between the shoulder and elbow.'],
  forearm_L: ['Forearm · L', 'The left lower arm and wrist connection.'],
  forearm_R: ['Forearm · R', 'The right lower arm and wrist connection.'],
  hand_L: ['Hand assembly · L', 'The terminal component of the left arm.'],
  hand_R: ['Hand assembly · R', 'The terminal component of the right arm.'],
  pelvis_center: ['Pelvic frame', 'The central connection between the torso and both legs.'],
  thigh_L: ['Upper leg · L', 'The left leg section between the hip and knee.'],
  thigh_R: ['Upper leg · R', 'The right leg section between the hip and knee.'],
  shin_foot_L: ['Lower leg · L', 'The left lower leg and foot assembly.'],
  shin_foot_R: ['Lower leg · R', 'The right lower leg and foot assembly.'],
};
const directions = {
  iso: new THREE.Vector3(.62, .22, 1).normalize(),
  front: new THREE.Vector3(0, .03, 1).normalize(),
  side: new THREE.Vector3(1, .03, 0).normalize(),
  back: new THREE.Vector3(0, .03, -1).normalize(),
  top: new THREE.Vector3(0, 1, .001).normalize(),
};
const viewNames = { iso: 'THREE-QUARTER VIEW', front: 'FRONT VIEW', side: 'SIDE VIEW', back: 'REAR VIEW', top: 'TOP VIEW' };
let stage, rig, interaction, tween, request = 0, value = 0, view = 'iso';
let selected = null, labels = true, autoRotate = false, visible = true, destroyed = false;
let previousTime = 0, settleUntil = 0, lastLeaderTime = 0;
let baseMaterials = [];
const listeners = [];
const lines = [];
const box = new THREE.Box3();
const point = new THREE.Vector3();
const namespace = 'http://www.w3.org/2000/svg';
const on = (el, event, fn, options) => {
  el.addEventListener(event, fn, options);
  listeners.push(() => el.removeEventListener(event, fn, options));
};
const ease = (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

function invalidate(ms = 350) {
  settleUntil = Math.max(settleUntil, performance.now() + ms);
  if (!request && visible && !document.hidden && !destroyed) request = requestAnimationFrame(render);
}

function apply(next) {
  value = THREE.MathUtils.clamp(next, 0, 1);
  scrub(rig, value);
  $('explode').value = String(Math.round(value * 1000));
  $('explode-value').textContent = `${Math.round(value * 100)}%`;
  $('assembly-status').textContent = value < .001 ? 'ASSEMBLED' : value > .999 ? 'SEPARATED' : `ASSEMBLY / ${Math.round(value * 100)}%`;
  $('separate').textContent = value > .5 ? 'REASSEMBLE' : 'SEPARATE PARTS';
  invalidate();
}

function setView(next, animate = true) {
  view = next;
  const sphere = new THREE.Box3().setFromObject(rig.root).getBoundingSphere(new THREE.Sphere());
  const halfV = THREE.MathUtils.degToRad(stage.camera.fov) / 2;
  const halfH = Math.atan(Math.tan(halfV) * stage.camera.aspect);
  const distance = sphere.radius * (mobile.matches ? 1.15 : 1.05) / Math.sin(Math.min(halfV, halfH));
  const position = sphere.center.clone().addScaledVector(directions[next], distance);
  stage.home.position.copy(position);
  stage.home.target.copy(sphere.center);
  if (animate && !reduced) stage.flyTo(position, sphere.center, 750);
  else {
    stage.cancelFlight();
    stage.camera.position.copy(position);
    stage.controls.target.copy(sphere.center);
    stage.controls.update();
  }
  stage.camera.near = Math.max(distance / 500, .005);
  stage.camera.far = Math.max(distance * 20, 100);
  stage.camera.updateProjectionMatrix();
  $('view-label').textContent = viewNames[next];
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === next));
  invalidate(1000);
}

function showSelection(info) {
  selected = info?.name ?? null;
  exhibit.classList.toggle('is-inspecting', Boolean(info));
  for (const b of partButtons) b.setAttribute('aria-pressed', String(b.dataset.part === selected));
  for (const line of lines) line.group.classList.toggle('selected', line.node.name === selected);
  $('component-card').hidden = !info;
  if (info) {
    const [title, description] = descriptions[info.name] ?? [info.name.replaceAll('_', ' '), 'An individual component of the original SAGE assembly.'];
    $('component-title').textContent = title;
    $('component-description').textContent = description;
  }
  invalidate(1000);
}

function createAnnotations() {
  for (const button of partButtons) {
    const node = rig.components.find((component) => component.name === button.dataset.part);
    if (!node) { button.hidden = true; continue; }
    button.setAttribute('aria-pressed', 'false');
    const group = document.createElementNS(namespace, 'g');
    const path = document.createElementNS(namespace, 'path');
    const dot = document.createElementNS(namespace, 'circle');
    dot.setAttribute('r', '2.5');
    group.append(path, dot);
    svg.append(group);
    lines.push({ node, button, group, path, dot });
    on(button, 'click', () => {
      interaction.setAutoRotate(false); autoRotate = false;
      $('rotate').setAttribute('aria-pressed', 'false');
      interaction.selectComponent(node);
    });
  }
}

function updateLeaders(now) {
  if (!labels || mobile.matches || now - lastLeaderTime < 32) return;
  lastLeaderTime = now;
  const rect = exhibit.getBoundingClientRect();
  const viewport = canvas.getBoundingClientRect();
  rig.root.updateMatrixWorld(true);
  stage.camera.updateMatrixWorld();
  for (const line of lines) {
    box.setFromObject(line.node).getCenter(point).project(stage.camera);
    const valid = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1;
    line.group.style.display = valid ? '' : 'none';
    if (!valid) continue;
    const x = viewport.left - rect.left + (point.x + 1) * .5 * viewport.width;
    const y = viewport.top - rect.top + (1 - point.y) * .5 * viewport.height;
    const anchor = line.button.getBoundingClientRect();
    const left = line.button.closest('.anatomy--left');
    const startX = (left ? anchor.right : anchor.left) - rect.left + (left ? 8 : -8);
    const startY = anchor.top - rect.top + 13;
    const elbow = startX + (left ? 30 : -30);
    line.path.setAttribute('d', `M${startX.toFixed(1)},${startY.toFixed(1)} L${elbow.toFixed(1)},${startY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}`);
    line.dot.setAttribute('cx', x.toFixed(1)); line.dot.setAttribute('cy', y.toFixed(1));
  }
}

function setFinish(name) {
  for (const base of baseMaterials) {
    const m = base.material;
    if (name === 'original') {
      m.color.copy(base.color); m.map = base.map;
      m.roughness = base.roughness; m.metalness = base.metalness;
    } else {
      m.map = null;
      m.color.set(name === 'porcelain' ? 0xe3e1d6 : 0x30383e);
      m.roughness = name === 'porcelain' ? .32 : .42;
      m.metalness = name === 'porcelain' ? .12 : .65;
    }
    m.needsUpdate = true;
  }
  for (const b of finishButtons) b.setAttribute('aria-pressed', String(b.dataset.finish === name));
  invalidate();
}

function wireControls() {
  on($('explode'), 'input', () => { tween = null; apply(Number($('explode').value) / 1000); });
  on($('separate'), 'click', () => {
    interaction.resetView();
    const to = value > .5 ? 0 : 1;
    if (reduced) { apply(to); setView(view, false); }
    else { tween = { from: value, to, start: performance.now() }; invalidate(1200); }
  });
  for (const b of viewButtons) on(b, 'click', () => {
    interaction.resetView(); setView(b.dataset.view);
  });
  for (const b of finishButtons) on(b, 'click', () => setFinish(b.dataset.finish));
  on($('labels'), 'click', () => {
    labels = !labels; exhibit.classList.toggle('annotations-off', !labels);
    $('labels').setAttribute('aria-pressed', String(labels)); invalidate();
  });
  on($('wireframe'), 'click', () => {
    const next = $('wireframe').getAttribute('aria-pressed') !== 'true';
    setWireframe(rig, next); $('wireframe').setAttribute('aria-pressed', String(next)); invalidate();
  });
  on($('rotate'), 'click', () => {
    autoRotate = !autoRotate; interaction.setAutoRotate(autoRotate);
    $('rotate').setAttribute('aria-pressed', String(autoRotate)); invalidate();
  });
  const resetSelection = () => { interaction.resetView(); setView(view); };
  on($('clear-selection'), 'click', resetSelection);
  on($('return-view'), 'click', resetSelection);
  on($('reset'), 'click', () => {
    tween = null; autoRotate = false; interaction.setAutoRotate(false);
    interaction.resetView(); setWireframe(rig, false); setFinish('original'); apply(0); setView('iso');
    labels = true; exhibit.classList.remove('annotations-off');
    $('labels').setAttribute('aria-pressed', 'true');
    $('wireframe').setAttribute('aria-pressed', 'false'); $('rotate').setAttribute('aria-pressed', 'false');
  });
  on($('fullscreen'), 'click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await exhibit.requestFullscreen(); }
    catch { $('live-status').textContent = 'Full screen is unavailable in this browser.'; }
  });
  on(document, 'fullscreenchange', () => {
    $('fullscreen').textContent = document.fullscreenElement ? 'EXIT FULL SCREEN' : 'FULL SCREEN'; invalidate(1000);
  });
  on(canvas, 'keydown', (event) => {
    if (event.key === 'Escape') resetSelection();
    if (event.key.toLowerCase() === 'r') $('reset').click();
  });
}

function render(now) {
  request = 0;
  if (destroyed || !visible || document.hidden) return;
  const dt = previousTime ? Math.min((now - previousTime) / 1000, .05) : 1 / 60;
  previousTime = now;
  if (tween) {
    const k = Math.min((now - tween.start) / 1000, 1);
    apply(tween.from + (tween.to - tween.from) * ease(k));
    if (k === 1) { tween = null; setView(view); }
  }
  interaction?.update();
  const flying = stage.updateFlight(now);
  const moving = stage.controls.update(dt);
  stage.renderer.render(stage.scene, stage.camera);
  if (rig) updateLeaders(now);
  if (tween || flying || moving || autoRotate || now < settleUntil) {
    if (!request) request = requestAnimationFrame(render);
  }
}

function destroy() {
  if (destroyed) return;
  destroyed = true; cancelAnimationFrame(request);
  for (const off of listeners) off();
  observer?.disconnect(); resizeObserver?.disconnect();
  interaction?.dispose();
  // Restore maps before disposal, including those temporarily hidden by a finish.
  for (const base of baseMaterials) base.material.map = base.map;
  stage?.dispose();
}

const observer = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  if (visible) invalidate();
}, { threshold: 0 });
observer.observe(canvas);
const resizeObserver = new ResizeObserver(() => {
  if (rig && !selected) setView(view, false);
  invalidate(500);
});
resizeObserver.observe(canvas);
on(document, 'visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(request); request = 0; }
  else invalidate();
});
on(window, 'pagehide', (event) => {
  if (event.persisted) { cancelAnimationFrame(request); request = 0; } else destroy();
});
on(window, 'pageshow', () => invalidate());
on($('retry'), 'click', () => window.location.reload());

async function init() {
  try {
    stage = createStage(canvas, { pixelRatioCap: mobile.matches ? 1.5 : 1.25 });
    stage.scene.environmentIntensity = .8;
    stage.renderer.toneMappingExposure = 1.15;
    on(canvas, 'pointermove', () => invalidate(400), { passive: true });
    on(canvas, 'pointerdown', () => { stage.cancelFlight(); invalidate(1000); }, { passive: true });
    on(canvas, 'pointerup', () => invalidate(1000), { passive: true });
    on(canvas, 'wheel', () => invalidate(1000), { passive: true });
    const onControlsChange = () => invalidate();
    stage.controls.addEventListener('change', onControlsChange);
    listeners.push(() => stage.controls.removeEventListener('change', onControlsChange));
    rig = await loadRobot({ onProgress: (event) => {
      if (destroyed) return;
      const ratio = event.lengthComputable ? event.loaded / event.total : .5;
      $('boot-progress').style.width = `${Math.round(ratio * 90)}%`;
      $('boot-label').textContent = ratio >= 1 ? 'Building the assembly' : 'Loading SAGE';
    } });
    if (destroyed) return;
    stage.scene.add(rig.root); stage.frame(rig.box, 1.05);
    baseMaterials = rig.materials.filter((m) => /head_shell|chest_center|pelvis_center|upperarm|thigh|shin/i.test(m.name)).map((material) => ({
      material, color: material.color.clone(), map: material.map,
      roughness: material.roughness, metalness: material.metalness,
    }));
    interaction = createInteraction({ stage, rig, canvas, onSelect: showSelection });
    const sphere = rig.box.getBoundingSphere(new THREE.Sphere());
    stage.controls.maxDistance = Math.max(14, sphere.radius * 16);
    stage.controls.minDistance = sphere.radius * .12;

    // Sparse technical floor: no post-processing or particle simulation.
    const grid = new THREE.GridHelper(sphere.radius * 6, 24, 0x292c30, 0x191d22);
    grid.position.set(sphere.center.x, rig.box.min.y - .015, sphere.center.z);
    grid.material.transparent = true; grid.material.opacity = .45; stage.scene.add(grid);
    const ringPoints = [];
    for (let i = 0; i <= 96; i++) {
      const angle = i / 96 * Math.PI * 2;
      ringPoints.push(new THREE.Vector3(sphere.center.x + Math.cos(angle) * sphere.radius * .65, grid.position.y + .002, sphere.center.z + Math.sin(angle) * sphere.radius * .65));
    }
    stage.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: 0x7c654b, transparent: true, opacity: .45 })));
    createAnnotations(); wireControls(); apply(0); setView('iso', false);
    for (const b of document.querySelectorAll('button:disabled, input:disabled')) b.disabled = false;
    if (!rig.clip) { $('explode').disabled = true; $('separate').disabled = true; }
    if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
    $('boot-progress').style.width = '100%'; $('boot').classList.add('is-done');
    setTimeout(() => { $('boot').hidden = true; }, reduced ? 0 : 450);
    invalidate(1200);
  } catch (error) {
    console.error('[SAGE V02]', error);
    $('boot-label').textContent = 'SAGE could not be loaded';
    $('boot-note').textContent = 'Check your connection and try again.';
    $('retry').hidden = false;
  }
}
init();
import.meta.hot?.dispose(destroy);
window.SAGE_V02 = { get stage() { return stage; }, get rig() { return rig; }, get interaction() { return interaction; }, get value() { return value; } };
