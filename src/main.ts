import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/800.css';
import '@fontsource/outfit/900.css';
import './style.css';
import { Game, STEP } from './game';
import { World } from './scene';
import { Sound } from './audio';
const pauseIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const soundIcon = (muted: boolean) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="note-stroke" d="M9 17.5V7l10-2v10.5M9 10l10-2"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>${muted ? '<path class="mute-stroke" d="M3 3l18 18"/>' : ''}</svg>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main class="game-frame"><canvas id="scene" aria-label="3D railway running game"></canvas><div class="vignette"></div>
<header class="topbar"><a class="brand" href="./" aria-label="RailJumper home"><img class="brand-logo" src="/railjumper-logo.png" width="52" height="52" alt="" /> RAILJUMPER</a><button id="sound" class="icon-button" aria-label="Mute sound" title="Mute sound"></button></header>
<div id="hud" class="hud" hidden><div class="stat"><span>SCORE</span><strong id="score">00000</strong></div><div class="stat coins"><span>COINS</span><strong><i>✦</i> <b id="coins">0</b></strong></div><button id="pause" class="icon-button" aria-label="Pause game" title="Pause (Esc)">${pauseIcon}</button></div>
<section id="welcome" class="welcome"><div class="eyebrow"><span></span> A LITTLE SPEED. A LOT OF SUNSHINE.</div><h1>Next stop:<br><em>full speed.</em></h1><p>Three tracks. Endless possibilities.<br>Race up ramps, leap between trains,<br>and chase the coins over the rooftops.</p><button id="start" class="primary">LET’S RUN <span>↗</span></button><div class="start-note">PRESS ENTER TO HIT THE TRACKS</div><div class="best-line"><span>♜</span><div>YOUR PERSONAL BEST<strong id="welcome-best">0 <small>PTS</small></strong></div></div></section>
<div id="scene-sticker" class="scene-sticker"><span>GOLD RAMPS LEAD UP</span><strong>Take the roof.</strong><svg width="75" height="26" viewBox="0 0 75 26" aria-hidden="true"><path d="M3 7 Q32 0 66 16 M54 4 L68 17 L51 22" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
<div id="modal" class="modal" hidden><section class="modal-card"><div id="modal-eyebrow" class="eyebrow">TAKE A BREATHER</div><h2 id="modal-title">On a break.</h2><p id="modal-copy">The tracks will be right here.</p><div id="results" class="results" hidden><div><span>SCORE</span><strong id="final-score">0</strong></div><div><span>DISTANCE</span><strong id="final-distance">0m</strong></div><div><span>COINS</span><strong id="final-coins">0</strong></div></div><div id="record" class="record"></div><button id="continue" class="primary">KEEP RUNNING <span>→</span></button><button id="restart" class="text-button">Start a fresh run</button></section></div>
<section class="controls" aria-label="How to play"><div class="control"><div class="keys"><kbd>←</kbd><kbd>→</kbd></div><div><strong>Switch tracks</strong><span>Make your next move</span></div></div><div class="control"><kbd>↑</kbd><div><strong>Jump</strong><span>Jump · cancel a slide</span></div></div><div class="control"><kbd>↓</kbd><div><strong>Slide</strong><span>Slide · drop from a jump</span></div></div><div class="control"><kbd>esc</kbd><div><strong>Pause</strong><span>Take a break</span></div></div><div class="swipe-guide"><div class="swipe-arrows" aria-hidden="true"><span class="swipe-up">↑</span><span>←</span><span>↓</span><span>→</span></div><div><strong>Swipe to move</strong><span>Left/right: tracks · Up: jump · Down: slide</span></div></div></section>
</main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const scene = $<HTMLCanvasElement>('scene');
let world: World;
try {
  world = new World(scene);
} catch {
  $('welcome').innerHTML =
    '<h1>A small detour.</h1><p>This game needs WebGL 2 graphics support. Please try a current browser with hardware acceleration enabled.</p>';
  throw new Error('WebGL initialization failed');
}
const game = new Game(),
  sound = new Sound();
(window as unknown as Record<symbol, Game>)[Symbol.for('railjumper.game')] = game;
game.entities = [
  { id: -1, kind: 'train', lane: 1, z: 35, y: 0, extra: 0, length: 28, ramp: true },
  { id: -2, kind: 'train', lane: 0, z: 55, y: 0, extra: 8, length: 34 },
  { id: -3, kind: 'low', lane: -1, z: 33, y: 0, extra: 0, length: 0.65 },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: -4 - i,
    kind: 'coin' as const,
    lane: 0,
    z: 5 + i * 2,
    y: 1,
    extra: 0,
    length: 0.4,
  })),
];
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is optional when browser storage is unavailable.
  }
}
let best = Math.max(0, Number(read('railjumper-best')) || 0);
sound.muted = read('railjumper-muted') === 'true';
$('welcome-best').innerHTML = `${best.toLocaleString()} <small>PTS</small>`;
function soundButton() {
  $('sound').innerHTML = soundIcon(sound.muted);
  $('sound').setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  $('sound').title = sound.muted ? 'Unmute sound' : 'Mute sound';
  $('sound').setAttribute('aria-pressed', String(sound.muted));
}
soundButton();
$('sound').onclick = () => {
  sound.unlock();
  sound.muted = !sound.muted;
  save('railjumper-muted', String(sound.muted));
  soundButton();
};
function start() {
  sound.unlock();
  game.start();
  $('welcome').hidden = true;
  $('scene-sticker').hidden = true;
  $('modal').hidden = true;
  $('hud').hidden = false;
  app.classList.add('playing', 'run-active');
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
function showPause() {
  if (game.phase !== 'playing') return;
  game.pause();
  app.classList.remove('playing');
  $('modal').hidden = false;
  $('modal-eyebrow').textContent = 'TAKE A BREATHER';
  $('modal-title').textContent = 'On a break.';
  $('modal-copy').textContent = 'Your next adventure can wait a moment.';
  $('results').hidden = true;
  $('record').textContent = '';
  $('restart').hidden = false;
  $('continue').innerHTML = 'KEEP RUNNING <span>→</span>';
  $('continue').focus();
}
function resume() {
  game.resume();
  app.classList.add('playing');
  $('modal').hidden = true;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
function end() {
  const newBest = game.score > best;
  best = Math.max(best, game.score);
  save('railjumper-best', String(best));
  app.classList.remove('playing');
  $('modal').hidden = false;
  $('modal-eyebrow').textContent = 'END OF THE LINE. FOR NOW.';
  $('modal-title').textContent = 'What a ride.';
  $('modal-copy').textContent = 'Shake it off. There’s another run in you.';
  $('results').hidden = false;
  $('final-score').textContent = game.score.toLocaleString();
  $('final-distance').textContent = `${Math.floor(game.distance)}m`;
  $('final-coins').textContent = String(game.coins);
  $('record').textContent = newBest
    ? `✦ NEW PERSONAL BEST · ${best.toLocaleString()} PTS`
    : `PERSONAL BEST · ${best.toLocaleString()} PTS`;
  $('continue').innerHTML = 'RUN IT BACK <span>↗</span>';
  $('restart').hidden = true;
  $('continue').focus();
}
game.onEvent = (event) => {
  sound.play(event);
  if (event === 'crash') end();
};
$('start').onclick = start;
$('pause').onclick = showPause;
$('restart').onclick = start;
$('continue').onclick = () => (game.phase === 'paused' ? resume() : start());
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter'].includes(e.key)) {
    if (e.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) return;
    e.preventDefault();
    if (e.repeat) return;
    switch (e.key) {
      case 'ArrowLeft':
        game.move(-1);
        break;
      case 'ArrowRight':
        game.move(1);
        break;
      case 'ArrowUp':
        game.jump();
        break;
      case 'ArrowDown':
        game.duck();
        break;
      case 'Escape':
        if (game.phase === 'paused') resume();
        else showPause();
        break;
      case 'Enter':
        if (game.phase === 'ready' || game.phase === 'over') start();
        else if (game.phase === 'paused') resume();
    }
  }
});
const SWIPE_THRESHOLD = 30;
let activeSwipe: { pointerId: number; x: number; y: number } | undefined;
scene.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || !event.isPrimary || game.phase !== 'playing') return;
  activeSwipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  scene.setPointerCapture(event.pointerId);
});
scene.addEventListener('pointerup', (event) => {
  if (!activeSwipe || event.pointerId !== activeSwipe.pointerId) return;
  const { x, y } = activeSwipe;
  activeSwipe = undefined;
  if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
  if (game.phase !== 'playing') return;
  const dx = event.clientX - x;
  const dy = event.clientY - y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
  if (Math.abs(dx) > Math.abs(dy)) game.move(dx < 0 ? -1 : 1);
  else if (dy < 0) game.jump();
  else game.duck();
});
const cancelSwipe = (event: PointerEvent) => {
  if (activeSwipe?.pointerId === event.pointerId) activeSwipe = undefined;
};
scene.addEventListener('pointercancel', cancelSwipe);
scene.addEventListener('lostpointercapture', cancelSwipe);
window.addEventListener('blur', showPause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) showPause();
});
window.addEventListener('resize', () => world.resize());
let previous = performance.now(),
  accumulator = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (game.phase === 'playing') {
    accumulator += dt;
    while (accumulator >= STEP) {
      game.update(STEP);
      accumulator -= STEP;
    }
  } else accumulator = 0;
  $('score').textContent = String(game.score).padStart(5, '0');
  $('coins').textContent = String(game.coins);
  app.classList.toggle('bonked', game.bonkFlash > 0);
  world.render(game, game.elapsed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
