# Railrush

A colorful 3D endless railway runner built with TypeScript and Three.js. All gameplay, rendering, procedural models, sound effects, and score persistence run in the browser.

## Run locally

Requires Node.js 22.12+ (or a supported newer LTS release).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Arrow left/right change tracks, up jumps, and down starts a timed slide. Escape pauses or resumes. Enter starts/restarts. Low striped barriers can be jumped; elevated striped barriers can be slid under. Change lanes to avoid trains. Coins add 10 points each, and every meter adds one point.

## Build and verify

```sh
npm test
npm run build
npm run preview
```

Upload the contents of `dist/` to a static host. There is no application server, database, runtime API, or account system. Local development and preview use Vite to serve static frontend files. Best score and mute preference use localStorage when available. Browser audio starts only following player interaction.

Desktop browsers with WebGL 2 and hardware acceleration are required. Models and sounds are generated locally. Difficulty rises from 14 to 28 units/second. Obstacles spawn in spaced rows with an open lane; coins also reward jumping low barriers. Rendering uses a fixed 120 Hz simulation and recycled scene objects.

## Structure

- `src/game.ts`: deterministic simulation, obstacle generation, collisions, scoring.
- `src/scene.ts`: procedural Three.js scene, animated runner, rendering and object reuse.
- `src/main.ts`, `src/style.css`: game screens, controls, pause/focus behavior, persistence.
- `src/audio.ts`: synthesized sound effects.
- `src/game.test.ts`: gameplay and extended-run tests.

## Browser smoke tests

With the local server running on port 5173:

```sh
npx playwright install --with-deps chromium firefox
npm run test:browser
```

The tests exercise keyboard input, pause, collisions, restart, focus loss, persisted settings, and resizing. Set `BROWSER=chromium` or `BROWSER=firefox` to test one browser. Set `SCREENSHOTS=1` to capture screenshots under `/tmp/railrush-<browser>-*.png`. Fonts are bundled with the application; no external asset requests are required.
