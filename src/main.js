import './style.css';
import { createStage, prefersReducedMotion } from './scene.js';
import { loadRobot, scrub, setWireframe, SCRUB_FROM, SCRUB_TO, EXPLODE_CLIP } from './robot.js';
import { createInteraction } from './interaction.js';
import { createUI } from './ui.js';

const canvas = document.querySelector('#viewport');
const stage = createStage(canvas);
const reduceMotion = prefersReducedMotion();

let rig = null;
let interaction = null;
let value = 0;
let tween = null;
let frameHandle = 0;

const ui = createUI({
  onScrub(v) {
    tween = null;
    apply(v);
  },
  onAssemble() { glideTo(0); },
  onExplode() { glideTo(1); },
  onReset() {
    interaction?.resetView();
  },
  onToggle(name, next) {
    if (!rig) return false;
    if (name === 'wireframe') {
      setWireframe(rig, next);
      return next;
    }
    if (name === 'optic') {
      if (!interaction?.hasOptic) return false;
      return interaction.setOptic(next);
    }
    if (name === 'autorotate') {
      interaction?.setAutoRotate(next);
      return next;
    }
    return next;
  },
});

ui.setEnabled(false);

function apply(v) {
  value = v;
  if (!rig) return;
  const t = scrub(rig, v);
  ui.setRow('cursor', `${t.toFixed(3)}s`);
}

function glideTo(target) {
  if (reduceMotion) {
    ui.setValue(target);
    apply(target);
    return;
  }
  tween = { from: value, to: target, start: performance.now(), ms: 900 };
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

ui.setProgress(0.05, 'ESTABLISHING LINK');

loadRobot({
  onProgress(e) {
    const ratio = e.lengthComputable ? e.loaded / e.total : 0.5;
    ui.setProgress(0.05 + 0.9 * ratio, 'DOWNLOADING GEOMETRY');
  },
})
  .then((loaded) => {
    rig = loaded;
    stage.scene.add(rig.root);
    stage.frame(rig.box);

    interaction = createInteraction({
      stage,
      rig,
      canvas,
      onSelect: (info) => ui.setSelection(info),
    });

    const to = SCRUB_TO ?? rig.clip?.duration ?? 0;
    const usesFallbackClip = rig.clip && rig.clip.name !== EXPLODE_CLIP;

    ui.setRow('clip', rig.clip ? rig.clip.name : 'NONE', !rig.clip || usesFallbackClip);
    ui.setRow('duration', rig.clip ? `${rig.clip.duration.toFixed(3)}s` : '—');
    ui.setRow('window', `${SCRUB_FROM.toFixed(2)}–${to.toFixed(2)}s`);
    ui.setRow('meshes', String(rig.meshes.length));
    ui.setRow('parts', String(rig.components.length));
    ui.setRow('materials', String(rig.materials.length));
    ui.setRow('optic', rig.optic ? rig.optic.label : 'NONE', !rig.optic);
    ui.setRow('load', `${Math.round(rig.loadMs)}ms`);
    ui.setRow('state', rig.clip ? 'READY' : 'NO CLIP');

    apply(0);
    ui.setEnabled(Boolean(rig.clip));
    if (!interaction.hasOptic) ui.disableToggle('optic');
    ui.finishBoot();
  })
  .catch((err) => {
    console.error('[SAGE] load failed', err);
    ui.setRow('state', 'FAULT', true);
    ui.fail('Model not found. Put robot_web_v02.glb in public/ and reload.');
  });

let last = performance.now();
let frames = 0;
let sampleStart = last;

function render(now) {
  frameHandle = requestAnimationFrame(render);

  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (tween) {
    const k = Math.min((now - tween.start) / tween.ms, 1);
    const v = tween.from + (tween.to - tween.from) * easeInOut(k);
    ui.setValue(v);
    apply(v);
    if (k === 1) tween = null;
  }

  interaction?.update();
  stage.updateFlight(now);
  stage.controls.update(dt);
  stage.renderer.render(stage.scene, stage.camera);

  frames += 1;
  if (now - sampleStart >= 500) {
    const fps = (frames * 1000) / (now - sampleStart);
    ui.setRow('fps', fps.toFixed(0), fps < 45);
    ui.setRow('triangles', stage.renderer.info.render.triangles.toLocaleString('en-US'));
    ui.setRow('calls', String(stage.renderer.info.render.calls));
    frames = 0;
    sampleStart = now;
  }
}

frameHandle = requestAnimationFrame(render);

function destroy() {
  cancelAnimationFrame(frameHandle);
  interaction?.dispose();
  ui.dispose();
  stage.dispose();
  rig = null;
  interaction = null;
}

window.addEventListener('pagehide', destroy, { once: true });
import.meta.hot?.dispose(destroy);

window.SAGE = {
  stage,
  get rig() { return rig; },
  get interaction() { return interaction; },
  apply,
  destroy,
};
