import './v02.css';
import * as THREE from 'three';
import { createStage, prefersReducedMotion } from './scene.js';
import { loadRobot, scrub, setWireframe } from './robot.js';
import { createInteraction, triangleCount } from './interaction.js';

const $ = (id) => document.getElementById(id);
const canvas = $('viewport');
const exhibit = $('exhibit');
const stageShell = $('stage-shell');
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

const chapters = [
  { phase: 'AWAKEN', title: 'Bring the system online.', copy: 'Power reaches the frame. The machine resolves from silhouette into structure.', from: 0, to: .22 },
  { phase: 'SUSPEND', title: 'Hold the machine in inspection space.', copy: 'SAGE leaves the floor. Weight becomes geometry; geometry becomes readable.', from: .22, to: .42 },
  { phase: 'DISASSEMBLE', title: 'Expose the logic under the shell.', copy: 'The field unit separates into systems, surfaces and structural decisions without a rigged animation.', from: .42, to: .72 },
  { phase: 'REASSEMBLE', title: 'Return it to combat form.', copy: 'Every component finds its place again. The study ends where the future encounter begins.', from: .72, to: 1 },
];

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
let storyScheduled = 0, storyChapter = -1, storyProgress = 0;
let rootBasePosition = null, rootBaseQuaternion = null, modelSphere = null;
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

function prettyName(raw, fallback) {
  const clean = (raw || fallback)
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(mesh|geo|geometry|object|part|tripo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
}

function createAnnotations() {
  const exact = new Map(rig.components.filter((component) => component.name).map((component) => [component.name, component]));
  const used = new Set();
  const fallbackPool = [...rig.components].sort((a, b) => triangleCount(b) - triangleCount(a));

  partButtons.forEach((button, index) => {
    const requested = button.dataset.part;
    let node = exact.get(requested);
    if (!node || used.has(node)) node = fallbackPool.find((candidate) => !used.has(candidate));
    if (!node) { button.hidden = true; return; }

    used.add(node);
    if (!node.name) node.name = 'sage_component_' + String(index + 1).padStart(2, '0');
    button.dataset.part = node.name;
    button.setAttribute('aria-pressed', 'false');

    if (node.name !== requested) {
      button.querySelector('strong').textContent = prettyName(node.name, 'Component ' + String(index + 1).padStart(2, '0'));
      button.querySelector('small').textContent = triangleCount(node).toLocaleString() + ' tris / field assembly';
    }

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
  });
}

function updateLeaders(now) {
  if (!labels || mobile.matches || now - lastLeaderTime < 32) return;
  lastLeaderTime = now;
  const rect = stageShell.getBoundingClientRect();
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


function chapterFor(progress) {
  return chapters.findIndex((chapter, index) => progress < chapter.to || index === chapters.length - 1);
}

function setChapter(index, progress) {
  const chapter = chapters[index];
  if (!chapter) return;
  if (storyChapter !== index) {
    storyChapter = index;
    exhibit.dataset.phase = String(index);
    $('chapter-index').textContent = String(index + 1).padStart(2, '0');
    $('chapter-phase').textContent = chapter.phase;
    $('chapter-title').textContent = chapter.title;
    $('chapter-copy').textContent = chapter.copy;
  }
  const local = THREE.MathUtils.clamp((progress - chapter.from) / Math.max(chapter.to - chapter.from, .0001), 0, 1);
  $('chapter-progress').style.transform = 'scaleX(' + local + ')';
}

function applyStory(progress) {
  if (!rig) return;
  storyProgress = progress;
  const chapter = chapterFor(progress);
  setChapter(chapter, progress);
  exhibit.classList.toggle('is-scrolled', progress > .035);

  let assembly = 0;
  if (progress >= .42 && progress < .72) {
    assembly = ease(THREE.MathUtils.clamp((progress - .42) / .30, 0, 1));
  } else if (progress >= .72) {
    assembly = 1 - ease(THREE.MathUtils.clamp((progress - .72) / .28, 0, 1));
  }
  apply(assembly);

  if (rootBasePosition && rootBaseQuaternion && modelSphere) {
    const liftIn = THREE.MathUtils.smoothstep(progress, .12, .3);
    const liftOut = 1 - THREE.MathUtils.smoothstep(progress, .78, 1);
    rig.root.position.copy(rootBasePosition);
    rig.root.position.y += modelSphere.radius * .055 * liftIn * liftOut;
    rig.root.quaternion.copy(rootBaseQuaternion);
    rig.root.rotateY(THREE.MathUtils.lerp(-.07, .12, THREE.MathUtils.smoothstep(progress, .08, .96)));
    rig.root.updateMatrixWorld(true);
  }

  stage.renderer.toneMappingExposure = THREE.MathUtils.lerp(.78, 1.15, THREE.MathUtils.smoothstep(progress, 0, .18));
  invalidate(500);
}

function updateStoryFromScroll() {
  storyScheduled = 0;
  if (!rig || destroyed) return;
  const rect = exhibit.getBoundingClientRect();
  const travel = Math.max(exhibit.offsetHeight - window.innerHeight, 1);
  applyStory(THREE.MathUtils.clamp(-rect.top / travel, 0, 1));
}

function scheduleStory() {
  if (!storyScheduled) storyScheduled = requestAnimationFrame(updateStoryFromScroll);
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
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stageShell.requestFullscreen(); }
    catch { $('live-status').textContent = 'Full screen is unavailable in this browser.'; }
  });
  on(document, 'fullscreenchange', () => {
    $('fullscreen').textContent = document.fullscreenElement ? 'EXIT FULL SCREEN' : 'FULL SCREEN'; invalidate(1000);
  });
  on(canvas, 'keydown', (event) => {
    if (event.key === 'Escape') resetSelection();
    if (event.key.toLowerCase() === 'r') $('reset').click();
  });
  on(window, 'scroll', scheduleStory, { passive: true });
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
  destroyed = true; cancelAnimationFrame(request); cancelAnimationFrame(storyScheduled);
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
observer.observe(stageShell);
const resizeObserver = new ResizeObserver(() => {
  if (rig && !selected) setView(view, false);
  invalidate(500);
});
resizeObserver.observe(canvas);
on(document, 'visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(request); request = 0; }
  else { invalidate(); scheduleStory(); }
});
on(window, 'pagehide', (event) => {
  if (event.persisted) { cancelAnimationFrame(request); request = 0; } else destroy();
});
on(window, 'pageshow', () => { invalidate(); scheduleStory(); });
on($('retry'), 'click', () => window.location.reload());

async function init() {
  try {
    stage = createStage(canvas, { pixelRatioCap: mobile.matches ? 1.5 : 1.25 });
    stage.scene.environmentIntensity = .8;
    stage.renderer.toneMappingExposure = .78;
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
    const surfaceMaterials = rig.materials.filter((material) => material?.color && !/optic|eye|lens|emissive/i.test(material.name || ''));
    const materialsToFinish = surfaceMaterials.length ? surfaceMaterials : rig.materials.filter((material) => material?.color);
    baseMaterials = materialsToFinish.map((material) => ({
      material, color: material.color.clone(), map: material.map,
      roughness: material.roughness, metalness: material.metalness,
    }));
    interaction = createInteraction({ stage, rig, canvas, onSelect: showSelection });
    const sphere = rig.box.getBoundingSphere(new THREE.Sphere());
    modelSphere = sphere.clone();
    rootBasePosition = rig.root.position.clone();
    rootBaseQuaternion = rig.root.quaternion.clone();
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
    if (!rig.canExplode) { $('explode').disabled = true; $('separate').disabled = true; }
    if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
    $('boot-progress').style.width = '100%'; $('boot').classList.add('is-done');
    setTimeout(() => { $('boot').hidden = true; }, reduced ? 0 : 450);
    scheduleStory(); invalidate(1200);
  } catch (error) {
    console.error('[SAGE V02]', error);
    $('boot-label').textContent = 'SAGE could not be loaded';
    $('boot-note').textContent = 'Check your connection and try again.';
    $('retry').hidden = false;
  }
}
init();
import.meta.hot?.dispose(destroy);
window.SAGE_V02 = { get stage() { return stage; }, get rig() { return rig; }, get interaction() { return interaction; }, get value() { return value; }, get storyProgress() { return storyProgress; } };
