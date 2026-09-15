import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_URL = `${import.meta.env.BASE_URL}robot_web_v02.glb`;
export const EXPLODE_CLIP = 'Explode';

export const SCRUB_FROM = 0.833;
export const SCRUB_TO = 2.5;

const NOT_SELECTABLE = /cable|wire|hose|bolt|screw|nut|washer|helper|ctrl|gizmo|root|empty/i;
const MIN_RELATIVE_SIZE = 0.035;
const OPTIC_NAME = /optic|eye|lens/i;

export function loadRobot({ onProgress } = {}) {
  const started = performance.now();

  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const root = gltf.scene;
        const meshes = [];
        const materials = new Map();

        root.traverse((o) => {
          if (!o.isMesh) return;
          meshes.push(o);
          for (const m of asArray(o.material)) if (m) materials.set(m.uuid, m);
        });

        const clips = gltf.animations;
        const clip = clips.find((c) => c.name === EXPLODE_CLIP) ?? clips[0] ?? null;

        let mixer = null;
        let action = null;
        if (clip) {
          mixer = new THREE.AnimationMixer(root);
          action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          action.paused = true;
          action.time = SCRUB_FROM;
          mixer.update(0);
        }

        const box = new THREE.Box3().setFromObject(root);
        const rig = {
          root, meshes,
          materials: [...materials.values()],
          clips, clip, mixer, action, box,
          loadMs: performance.now() - started,
        };

        rig.selectable = resolveSelectable(rig);
        rig.components = [...new Set(rig.selectable.map(componentOf))];
        rig.optic = resolveOptic(rig);

        report(rig);
        resolve(rig);
      },
      onProgress,
      reject,
    );
  });
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
  console.log('source:', MODEL_URL, `— ${Math.round(rig.loadMs)} ms`);
  console.table(
    rig.clips.map((c) => ({ clip: c.name, seconds: +c.duration.toFixed(4), tracks: c.tracks.length })),
  );
  if (!rig.clip) console.warn('no animation clips in this GLB');
  else if (rig.clip.name !== EXPLODE_CLIP) {
    console.warn(`clip "${EXPLODE_CLIP}" not found — using "${rig.clip.name}"`);
  }
  console.log('meshes (%d):', rig.meshes.length, rig.meshes.map((m) => m.name));
  console.log('materials (%d):', rig.materials.length, rig.materials.map((m) => m.name));
  console.log('selectable components (%d):', rig.components.length, rig.components.map((c) => c.name));
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
    if (!name || NOT_SELECTABLE.test(name)) return false;
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

export function scrub(rig, value) {
  if (!rig.action) return 0;
  const to = SCRUB_TO ?? rig.clip.duration;
  const t = SCRUB_FROM + THREE.MathUtils.clamp(value, 0, 1) * (to - SCRUB_FROM);
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
