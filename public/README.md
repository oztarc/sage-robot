# Place the model here

Copy the exported asset into this folder as:

    public/robot_web_v02.glb

Vite serves `public/` at the site root, which is where `src/robot.js` loads
from (`${import.meta.env.BASE_URL}robot_web_v02.glb`).

The real asset is not included in this package. `npm run fixture` writes a
throwaway placeholder here for testing — delete it before using the real model.
