import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const VIEW_DIR = new THREE.Vector3(0.62, 0.34, 1).normalize();
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08090b);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xfff1de, 2.6);
  const rim = new THREE.DirectionalLight(0x9dc4ff, 2.2);
  const under = new THREE.DirectionalLight(0xffffff, 0.35);
  key.position.set(2.4, 3.1, 2.8);
  rim.position.set(-2.6, 1.5, -3.0);
  under.position.set(0, -2.5, 1.2);
  scene.add(key, rim, under);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(1.2, 0.9, 1.9);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.75;
  controls.panSpeed = 0.6;
  controls.zoomToCursor = true;
  controls.minDistance = 0.12;
  controls.maxDistance = 14;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 0.5, 0);
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const home = { position: new THREE.Vector3(), target: new THREE.Vector3() };

  function distanceFor(radius, margin) {
    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
    return (radius * margin) / Math.sin(Math.min(fovV, fovH) / 2);
  }

  function frame(box, margin = 1.45) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = distanceFor(sphere.radius, margin);

    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(VIEW_DIR, dist);

    camera.near = Math.max(dist / 500, 0.005);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();

    home.position.copy(camera.position);
    home.target.copy(controls.target);

    const reach = sphere.radius * 4;
    key.position.copy(sphere.center).add(new THREE.Vector3(2.4, 3.1, 2.8).setLength(reach));
    rim.position.copy(sphere.center).add(new THREE.Vector3(-2.6, 1.5, -3.0).setLength(reach));
    under.position.copy(sphere.center).add(new THREE.Vector3(0, -2.5, 1.2).setLength(reach));
  }

  let flight = null;

  function flyTo(position, target, ms = 850) {
    flight = {
      fromPos: camera.position.clone(),
      fromTgt: controls.target.clone(),
      toPos: position.clone(),
      toTgt: target.clone(),
      start: performance.now(),
      ms: prefersReducedMotion() ? 1 : ms,
    };
  }

  function flyToSphere(sphere, margin = 2.1, ms = 850) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-8) dir.copy(VIEW_DIR);
    dir.normalize();
    const dist = THREE.MathUtils.clamp(
      distanceFor(sphere.radius, margin),
      controls.minDistance * 1.05,
      controls.maxDistance * 0.95,
    );
    flyTo(sphere.center.clone().addScaledVector(dir, dist), sphere.center, ms);
  }

  function goHome(ms = 850) {
    flyTo(home.position, home.target, ms);
  }

  function updateFlight(now) {
    if (!flight) return false;
    const k = Math.min((now - flight.start) / flight.ms, 1);
    const e = easeInOut(k);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
    controls.target.lerpVectors(flight.fromTgt, flight.toTgt, e);
    if (k === 1) flight = null;
    return true;
  }

  const cancelFlight = () => { flight = null; };

  function applySize(w, h) {
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    let w;
    let h;
    if (entry.contentBoxSize) {
      const box = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize;
      w = box.inlineSize;
      h = box.blockSize;
    } else {
      w = entry.contentRect.width;
      h = entry.contentRect.height;
    }
    applySize(Math.round(w), Math.round(h));
  });
  observer.observe(canvas);

  let dprQuery = null;
  function onDpr() {
    applySize(canvas.clientWidth, canvas.clientHeight);
    watchPixelRatio();
  }
  function watchPixelRatio() {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  }
  watchPixelRatio();

  applySize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

  function dispose() {
    observer.disconnect();
    dprQuery?.removeEventListener('change', onDpr);
    controls.dispose();

    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const value of Object.values(m)) {
          if (value && value.isTexture) value.dispose();
        }
        m.dispose();
      }
    });

    scene.clear();
    envTarget.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return {
    renderer, scene, camera, controls, home,
    frame, flyTo, flyToSphere, goHome, updateFlight, cancelFlight,
    dispose,
    lights: { key, rim, under },
  };
}
