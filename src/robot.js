import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_URL = import.meta.env.BASE_URL + 'robo_smooth_parts.glb';
export const EXPLODE_CLIP = 'Explode';

export const SCRUB_FROM = 0.833;
export const SCRUB_TO = 2.5;

const NOT_SELECTABLE = /cable|wire|hose|bolt|screw|nut|washer|helper|ctrl|gizmo|root|empty/i;
const MIN_RELATIVE_SIZE = 0.018;
const OPTIC_NAME = /optic|eye|lens/i;

function loadUrl(url, onProgress) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, onProgress, reject);
  });
}

export async function loadRobot({ onProgress } = {}) {
  const started = performance.now();
  const sourceUrl = MODEL_URL;
  const gltf = await loadUrl(sourceUrl, onProgress);

  const root = gltf.scene;
  const meshes = [];
  const materials = new Map();

  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    for (const m of asArray(o.material)) if (m) materials.set(m.uuid, m);
  });

  const clips = gltf.animations;
  const clip = clips.find((clipItem) => clipItem.name === EXPLODE_CLIP) ?? clips[0] ?? null;

  let mixer = null;
  let action = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(root);
    action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    action.time = Math.min(SCRUB_FROM, clip.duration);
    mixer.update(0);
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const rig = {
    root, meshes,
    materials: [...materials.values()],
    clips, clip, mixer, action, box,
    sourceUrl,
    loadMs: performance.now() - started,
  };

  rig.selectable = resolveSelectable(rig);
  rig.components = [...new Set(rig.selectable.map(componentOf))];
  rig.optic = resolveOptic(rig);
  rig.explodeTargets = buildProceduralExplode(rig);
  rig.canExplode = Boolean(rig.action || rig.explodeTargets.length > 1);

  report(rig);
  return rig;
}

const asArray = (m) => (Array.isArray(m) ? m : [m]);

export function componentOf(object) {
  const parent = object.parent;
  if (parent && parent.isGroup && parent.children.every((c) => c.isMesh)) return parent;
  return object;
}

export function componentMeshes(component) {
  if (component.isMesh) return [component];
  return component.children.filter((c) => c.isMesh);
}

function report(rig) {
  console.group('%c[SAGE] model loaded', 'color:#ff9e3d');
  console.log('source:', rig.sourceUrl, '— ' + Math.round(rig.loadMs) + ' ms');
  console.table(
    rig.clips.map((c) => ({ clip: c.name, seconds: +c.duration.toFixed(4), tracks: c.tracks.length })),
  );
  if (!rig.clip) console.info('no animation clips — procedural assembly separation enabled');
  else if (rig.clip.name !== EXPLODE_CLIP) {
    console.warn(`clip "${EXPLODE_CLIP}" not found — using "${rig.clip.name}"`);
  }
  console.log('meshes (%d):', rig.meshes.length, rig.meshes.map((m) => m.name));
  console.log('materials (%d):', rig.materials.length, rig.materials.map((m) => m.name));
  console.log('selectable components (%d):', rig.components.length, rig.components.map((component) => component.name));
  console.log('procedural explode targets:', rig.explodeTargets.length);
  console.log(
    'optic:',
    rig.optic
      ? `${rig.optic.source} "${rig.optic.label}" → ${rig.optic.materials.length} material(s)`
      : 'not found',
  );
  console.log('scrub window:', `${SCRUB_FROM}s → ${SCRUB_TO ?? rig.clip?.duration}s`);
  console.groupEnd();
}

function resolveSelectable(rig) {
  const modelRadius = rig.box.getBoundingSphere(new THREE.Sphere()).radius || 1;
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();

  return rig.meshes.filter((m) => {
    const component = componentOf(m);
    const name = component.name || m.name;
    if (name && NOT_SELECTABLE.test(name)) return false;
    box.setFromObject(component).getBoundingSphere(sphere);
    return sphere.radius / modelRadius >= MIN_RELATIVE_SIZE;
  });
}

function resolveOptic(rig) {
  const prefer = (list, get) => {
    const named = list.filter((x) => OPTIC_NAME.test(get(x) ?? ''));
    if (!named.length) return null;
    return named.find((x) => /optic[_-]?core/i.test(get(x))) ?? named[0];
  };

  const mesh = prefer(rig.meshes, (m) => m.name);
  if (mesh) {
    return { source: 'mesh', label: mesh.name, mesh, materials: asArray(mesh.material).filter(Boolean) };
  }

  const material = prefer(rig.materials, (m) => m.name);
  if (material) {
    return { source: 'material', label: material.name, mesh: null, materials: [material] };
  }

  const emissive = rig.materials.filter(
    (m) => m.emissive && m.emissive.getHex() !== 0x000000 && m.emissiveIntensity > 0,
  );
  if (emissive.length) {
    return { source: 'emissive-scan', label: emissive[0].name || 'unnamed', mesh: null, materials: emissive };
  }

  return null;
}

function buildProceduralExplode(rig) {
  const targets = [...new Set(rig.meshes.map(componentOf))].filter((object) => object !== rig.root);
  if (targets.length < 2) return [];

  rig.root.updateMatrixWorld(true);
  const modelSphere = rig.box.getBoundingSphere(new THREE.Sphere());
  const modelCenter = modelSphere.center.clone();
  const componentBox = new THREE.Box3();
  const componentCenter = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();

  return targets.map((object, index) => {
    componentBox.setFromObject(object).getCenter(componentCenter);
    const radial = componentCenter.clone().sub(modelCenter);

    if (radial.lengthSq() < 1e-7) {
      const angle = index * 2.399963229728653;
      radial.set(Math.cos(angle), ((index % 7) - 3) * 0.08, Math.sin(angle));
    }
    radial.normalize();

    const parent = object.parent ?? rig.root;
    p0.copy(componentCenter);
    p1.copy(componentCenter).addScaledVector(radial, modelSphere.radius);
    parent.worldToLocal(p0);
    parent.worldToLocal(p1);
    const localDirection = p1.sub(p0).normalize();

    const radialDistance = componentCenter.distanceTo(modelCenter) / Math.max(modelSphere.radius, 1e-6);
    const spread = modelSphere.radius * THREE.MathUtils.lerp(
      0.32,
      0.72,
      THREE.MathUtils.clamp(radialDistance, 0, 1),
    );

    return {
      object,
      basePosition: object.position.clone(),
      offset: localDirection.multiplyScalar(spread),
    };
  });
}

function proceduralScrub(rig, value) {
  const t = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(value, 0, 1), 0, 1);
  for (const target of rig.explodeTargets) {
    target.object.position.copy(target.basePosition).addScaledVector(target.offset, t);
  }
  rig.root.updateMatrixWorld(true);
  return t;
}

export function scrub(rig, value) {
  if (!rig.action) return proceduralScrub(rig, value);
  const to = Math.min(SCRUB_TO ?? rig.clip.duration, rig.clip.duration);
  const from = Math.min(SCRUB_FROM, to);
  const t = from + THREE.MathUtils.clamp(value, 0, 1) * (to - from);
  rig.action.paused = true;
  rig.action.time = t;
  rig.mixer.update(0);
  return t;
}

export function setWireframe(rig, on) {
  for (const m of rig.materials) {
    if ('wireframe' in m) m.wireframe = on;
  }
}
