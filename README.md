# Sage Protocol — Interactive System 01

Three.js viewer for `robot_web_v02.glb`: orbit, manual Explode scrubbing,
wireframe, optic glow, auto-rotate, hover highlighting and click-to-focus.

## Setup

```bash
npm install
cp /path/to/robot_web_v02.glb public/
npm run dev
```

Production build:

```bash
npm run build && npm run preview
```

## Layout

```
index.html
package.json
vite.config.js
public/
  robot_web_v02.glb      <- you provide this
src/
  main.js                entry point, render loop, scrub tween, telemetry
  scene.js               renderer, camera, lights, OrbitControls, framing, flight, disposal
  robot.js               GLB load, clip discovery, scrub(), wireframe, component + optic resolution
  interaction.js         raycaster, hover, selection, camera focus, optic + auto-rotate
  ui.js                  HUD wiring
  style.css              HUD styling
tools/
  make-test-glb.mjs      writes a stand-in asset for testing
  smoke.mjs              headless acceptance run
```

## Scrub range

`src/robot.js`:

```js
export const SCRUB_FROM = 0.833;
export const SCRUB_TO = 2.5;
```

The authored clip is 3.75s but holds assembled until 0.833s and is fully
exploded at 2.5s. Restricting the slider to that window removes ~56% of dead
travel. Set `SCRUB_TO = null` to cover the whole clip instead.

## Components

Raycast hits are promoted to the glTF node via `componentOf()`. `head_shell`,
`forearm_R` and `shin_foot_R` each carry two primitives, so GLTFLoader wraps
them in a Group; without this you would select `head_shell_mesh_1` instead of
`head_shell`.

Selectable parts exclude anything matching
`/cable|wire|hose|bolt|screw|nut|washer|helper|ctrl|gizmo|root|empty/i`
and anything whose bounding sphere is under 3.5% of the model radius.

## Optic

This asset has no mesh named `optic`, `eye` or `lens` — the optic is a
**material** (`optic_core_emissive`) on a second slot of `head_shell`. The
lookup searches mesh names first, then material names, preferring
`optic_core`, and falls back to scanning for any already-emissive material.
The OPTIC button multiplies its base `emissiveIntensity` by 7.

Hover and selection never swap materials. `EmissiveLedger` records each
material's original `emissive` colour and `emissiveIntensity`; already-emissive
materials get an intensity gain, matte ones get a low amber tint. The OPTIC
toggle writes through the same ledger, so a part hovered while the optic is
boosted still restores correctly.

## Testing without the real asset

```bash
npm i -D playwright && npx playwright install chromium
npm run fixture
npm run build
npm run preview &
npm run smoke http://localhost:4173/
rm public/robot_web_v02.glb
```

## Not implemented

Bloom post-processing. The optic is emissive-only for now, to keep the frame
cost at a single forward pass while you benchmark.
