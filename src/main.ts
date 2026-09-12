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
const icon = (name: string) => ({ sound: '♫', mute: '♪', pause: 'Ⅱ', play: '▶', coin: '✦' })[name] ?? name;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="./" aria-label="Railrush home"><span class="brand-icon">↟</span> RAILRUSH<span class="brand-dot">®</span></a><div class="edition"><span></span> THE ENDLESS SUMMER RUN</div><button id="sound" class="icon-button" aria-label="Mute sound" title="Mute sound">♫</button></header>
<main><div class="game-frame"><canvas id="scene" aria-label="3D railway running game"></canvas><div class="vignette"></div>
<div class="scene-label"><span class="live-dot"></span> SUNCOAST LINE <span class="label-divider">/</span> ENDLESS MODE</div>
<div id="hud" class="hud" hidden><div class="stat"><span>SCORE</span><strong id="score">00000</strong></div><div class="stat coins"><span>COINS</span><strong><i>✦</i> <b id="coins">0</b></strong></div><button id="pause" class="icon-button" aria-label="Pause game" title="Pause (Esc)">Ⅱ</button></div>
<section id="welcome" class="welcome"><div class="eyebrow"><span></span> A LITTLE SPEED. A LOT OF SUNSHINE.</div><h1>Next stop:<br><em>full speed.</em></h1><p>Three tracks. Endless possibilities.<br>Race up ramps, leap between trains,<br>and chase the coins over the rooftops.</p><button id="start" class="primary">LET’S RUN <span>↗</span></button><div class="start-note">PRESS ENTER TO HIT THE TRACKS</div><div class="best-line"><span>♜</span><div>YOUR PERSONAL BEST<strong id="welcome-best">0 <small>PTS</small></strong></div></div></section>
<div id="scene-sticker" class="scene-sticker"><span>GOLD RAMPS LEAD UP</span><strong>Take the roof.</strong><svg width="75" height="26" viewBox="0 0 75 26" aria-hidden="true"><path d="M3 7 Q32 0 66 16 M54 4 L68 17 L51 22" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
<div id="modal" class="modal" hidden><section class="modal-card"><div id="modal-eyebrow" class="eyebrow">TAKE A BREATHER</div><h2 id="modal-title">On a break.</h2><p id="modal-copy">The tracks will be right here.</p><div id="results" class="results" hidden><div><span>SCORE</span><strong id="final-score">0</strong></div><div><span>DISTANCE</span><strong id="final-distance">0m</strong></div><div><span>COINS</span><strong id="final-coins">0</strong></div></div><div id="record" class="record"></div><button id="continue" class="primary">KEEP RUNNING <span>→</span></button><button id="restart" class="text-button">Start a fresh run</button></section></div>
<div class="scene-bottom"><span id="status">YOUR DAILY DOSE OF FORWARD MOTION.</span><span><i></i> ALL GOOD AHEAD</span></div>
</div>
<section class="controls" aria-label="How to play"><div class="controls-title"><span>THE BASICS</span><strong>Find your rhythm.</strong></div><div class="control"><div class="keys"><kbd>←</kbd><kbd>→</kbd></div><div><strong>Switch tracks</strong><span>Make your next move</span></div></div><div class="control"><kbd>↑</kbd><div><strong>Jump</strong><span>Jump · cancel a slide</span></div></div><div class="control"><kbd>↓</kbd><div><strong>Slide</strong><span>Slide · drop from a jump</span></div></div><div class="control pause-hint"><kbd>esc</kbd><div><strong>Take a break</strong><span>Pause your run</span></div></div></section>
</main><footer><span>BUILT FOR THE THRILL OF THE RUN.</span><span>NO FINISH LINE. JUST GOOD TIMES. <i>✳</i></span></footer>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let world: World;
try { world = new World($<HTMLCanvasElement>('scene')); }
catch { $('welcome').innerHTML = '<h1>A small detour.</h1><p>This game needs WebGL 2 graphics support. Please try a current desktop browser with hardware acceleration enabled.</p>'; throw new Error('WebGL initialization failed'); }
const game = new Game(), sound = new Sound();
game.entities = [
  { id: -1, kind: 'train', lane: 1, z: 35, y: 0, extra: 0, length: 28, ramp: true },
  { id: -2, kind: 'train', lane: 0, z: 55, y: 0, extra: 8, length: 34 },
  { id: -3, kind: 'low', lane: -1, z: 33, y: 0, extra: 0, length: .65 },
  ...Array.from({ length: 7 }, (_, i) => ({ id: -4 - i, kind: 'coin' as const, lane: 0, z: 5 + i * 2, y: 1, extra: 0, length: .4 })),
];
function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
let best = Math.max(0, Number(read('railrush-best')) || 0);
sound.muted = read('railrush-muted') === 'true';
$('welcome-best').innerHTML = `${best.toLocaleString()} <small>PTS</small>`;
function soundButton() { $('sound').textContent = icon(sound.muted ? 'mute' : 'sound'); $('sound').setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound'); $('sound').title = sound.muted ? 'Unmute sound' : 'Mute sound'; $('sound').setAttribute('aria-pressed', String(sound.muted)); }
soundButton();
$('sound').onclick = () => { sound.unlock(); sound.muted = !sound.muted; save('railrush-muted', String(sound.muted)); soundButton(); };
function start() {
  sound.unlock(); game.start(); $('welcome').hidden = true; $('scene-sticker').hidden = true; $('modal').hidden = true; $('hud').hidden = false;
  $('status').textContent = 'STAY SHARP. KEEP MOVING.'; app.classList.add('running');
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
function showPause() {
  if (game.phase !== 'playing') return;
  game.pause(); $('modal').hidden = false; $('modal-eyebrow').textContent = 'TAKE A BREATHER'; $('modal-title').textContent = 'On a break.'; $('modal-copy').textContent = 'Your next adventure can wait a moment.'; $('results').hidden = true; $('record').textContent = ''; $('restart').hidden = false; $('continue').innerHTML = 'KEEP RUNNING <span>→</span>'; $('continue').focus();
}
function resume() { game.resume(); $('modal').hidden = true; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }
function end() {
  const newBest = game.score > best; best = Math.max(best, game.score); save('railrush-best', String(best));
  $('modal').hidden = false; $('modal-eyebrow').textContent = 'END OF THE LINE. FOR NOW.'; $('modal-title').textContent = 'What a ride.'; $('modal-copy').textContent = 'Shake it off. There’s another run in you.'; $('results').hidden = false; $('final-score').textContent = game.score.toLocaleString(); $('final-distance').textContent = `${Math.floor(game.distance)}m`; $('final-coins').textContent = String(game.coins); $('record').textContent = newBest ? `✦ NEW PERSONAL BEST · ${best.toLocaleString()} PTS` : `PERSONAL BEST · ${best.toLocaleString()} PTS`; $('continue').innerHTML = 'RUN IT BACK <span>↗</span>'; $('restart').hidden = true; $('status').textContent = 'EVERY RUN IS A NEW BEGINNING.'; $('continue').focus();
}
game.onEvent = event => { sound.play(event); if (event === 'crash') end(); };
$('start').onclick = start; $('pause').onclick = showPause; $('restart').onclick = start;
$('continue').onclick = () => game.phase === 'paused' ? resume() : start();
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter'].includes(e.key)) {
    if (e.key === 'Enter' && document.activeElement instanceof HTMLButtonElement) return;
    e.preventDefault(); if (e.repeat) return;
    switch (e.key) { case 'ArrowLeft': game.move(-1); break; case 'ArrowRight': game.move(1); break; case 'ArrowUp': game.jump(); break; case 'ArrowDown': game.duck(); break; case 'Escape': game.phase === 'paused' ? resume() : showPause(); break; case 'Enter': if (game.phase === 'ready' || game.phase === 'over') start(); else if (game.phase === 'paused') resume(); }
  }
});
window.addEventListener('blur', showPause); document.addEventListener('visibilitychange', () => { if (document.hidden) showPause(); });
window.addEventListener('resize', () => world.resize());
let previous = performance.now(), accumulator = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, .1); previous = now;
  if (game.phase === 'playing') { accumulator += dt; while (accumulator >= STEP) { game.update(STEP); accumulator -= STEP; } } else accumulator = 0;
  $('score').textContent = String(game.score).padStart(5, '0'); $('coins').textContent = String(game.coins);
  world.render(game, game.elapsed); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
