# Repository Guidelines

## Project Structure & Module Organization

RailJumper is a browser-only TypeScript/Three.js game built with Vite.
Application code is in `src/`: `game.ts` contains the deterministic simulation and obstacle logic, `scene.ts` owns Three.js rendering, `main.ts` wires UI and input, `audio.ts` synthesizes effects, and `style.css` defines the interface.
Unit tests live beside the simulation in `src/game.test.ts`; Playwright smoke tests are in `tests/browser.mjs` and `tests/rooftops.mjs`.
Vite builds deployable static files to `dist/`.

## Build, Test, and Development Commands

- `npm install` installs the Node.js 22.12+ dependencies.
- `npm run dev` starts Vite for local development on all interfaces.
- `npm run build` type-checks with TypeScript and produces `dist/`.
- `npm test` runs the Vitest simulation suite once.
- `npm run lint` checks TypeScript and browser-test code with ESLint.
- `npm run format:check` verifies Prettier formatting; use `npm run format` to apply it.
- With the dev server listening on port 5173, run `npm run test:browser` or `npm run test:rooftops` for Chromium smoke coverage.
  Install Chromium first with `npx playwright install --with-deps chromium` when needed.

## Coding Style & Naming Conventions

Use TypeScript for game code and ES modules throughout.
Let Prettier govern formatting: single quotes, trailing commas, and a 100-character print width.
Use two-space indentation.
Name classes and types in `PascalCase`, functions and variables in `camelCase`, and constants in `UPPER_SNAKE_CASE` (for example, `GENERATION_DISTANCE`).
Keep simulation behavior deterministic by passing seeded/random callbacks rather than using hidden global randomness.

Write clean and readable code.
Add explanatory comments for things that are not obvious.
However, do not add comments to code you did not change.

In the `README.md` and `AGENTS.md` make sure that there is only one sentence per line.
Between two consecutive sentences there must be a line break.
This makes git diffs easier to read.

## Testing Guidelines

Add or update focused Vitest cases in `src/game.test.ts` for gameplay changes.
Describe player-visible behavior and use concise `it('...')` names, as existing tests do.
Run `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` before submitting.
Update the browser tests when a UI, input, rendering, persistence, or regression path changes.

## Commit & Pull Request Guidelines

Do not commit anything.
The maintainer of this project will commit your changes manually.
However, you may still use git to look at the history, if needed.

## Notes

Make sure to update the `AGENTS.md` if necessary, so that it stays up to date.
