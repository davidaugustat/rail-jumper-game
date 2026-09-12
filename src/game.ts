export type Kind = 'low' | 'high' | 'train' | 'coin';
export interface Entity { id: number; kind: Kind; lane: number; z: number; y: number; extra: number; length: number }
export type Phase = 'ready' | 'playing' | 'paused' | 'over';
export const LANE_WIDTH = 3;
export const SLIDE_TIME = .8;
export const JUMP_SPEED = 9;
export const GRAVITY = 24;
export const MAX_SPEED = 28;
export const STEP = 1 / 120;
export function pattern(random: () => number) {
  const safe = Math.floor(random() * 3) - 1;
  const train = random() < .42;
  const lanes = [-1, 0, 1].filter(l => l !== safe);
  return { safe, obstacles: train ? [{ lane: lanes[Math.floor(random() * lanes.length)], kind: 'train' as Kind }] : lanes.map(lane => ({ lane, kind: (random() < .5 ? 'low' : 'high') as Kind })) };
}
export class Game {
  phase: Phase = 'ready'; lane = 0; x = 0; y = 0; vy = 0; slide = 0;
  distance = 0; coins = 0; elapsed = 0; entities: Entity[] = []; nextId = 0; spawnClock = 0;
  onEvent: (event: 'jump' | 'coin' | 'crash') => void = () => {};
  constructor(public random: () => number = Math.random) {}
  get speed() { return Math.min(MAX_SPEED, 14 + this.elapsed * .15); }
  get score() { return Math.floor(this.distance) + this.coins * 10; }
  start() { this.phase = 'playing'; this.lane = this.x = this.y = this.vy = this.slide = this.distance = this.coins = this.elapsed = this.nextId = 0; this.entities = []; this.spawnClock = 0; }
  move(direction: number) { if (this.phase === 'playing') this.lane = Math.max(-1, Math.min(1, this.lane + direction)); }
  jump() { if (this.phase === 'playing' && this.y === 0 && this.slide === 0) { this.vy = JUMP_SPEED; this.onEvent('jump'); } }
  duck() { if (this.phase === 'playing' && this.y === 0 && this.vy === 0 && this.slide === 0) this.slide = SLIDE_TIME; }
  pause() { if (this.phase === 'playing') this.phase = 'paused'; }
  resume() { if (this.phase === 'paused') this.phase = 'playing'; }
  spawn() {
    const p = pattern(this.random);
    for (const obstacle of p.obstacles) {
      const extra = obstacle.kind === 'train' && this.random() < .6 ? 8 : 0;
      this.entities.push({ id: this.nextId++, ...obstacle, z: (this.speed + extra) * 4, y: 0, extra, length: obstacle.kind === 'train' ? 7 : .65 });
    }
    for (let i = 0; i < 6; i++) this.entities.push({ id: this.nextId++, kind: 'coin', lane: p.safe, z: this.speed * 4 + i * 1.8, y: 1, extra: 0, length: .4 });
    const low = p.obstacles.find(o => o.kind === 'low');
    if (low) for (let i = -1; i <= 1; i++) this.entities.push({ id: this.nextId++, kind: 'coin', lane: low.lane, z: this.speed * 4 + i * 1.6, y: 2.4 - Math.abs(i) * .25, extra: 0, length: .4 });
  }
  update(dt: number) {
    if (this.phase !== 'playing') return;
    this.elapsed += dt; this.distance += this.speed * dt;
    const oldX = this.x;
    this.x += Math.max(-18 * dt, Math.min(18 * dt, this.lane * LANE_WIDTH - this.x));
    if (this.vy !== 0 || this.y > 0) { this.y += this.vy * dt - .5 * GRAVITY * dt * dt; this.vy -= GRAVITY * dt; if (this.y <= 0) this.y = this.vy = 0; }
    this.slide = Math.max(0, this.slide - dt);
    this.spawnClock -= dt;
    if (this.spawnClock <= 0) { this.spawn(); this.spawnClock += 2.8; }
    for (const e of this.entities) {
      const prev = e.z; e.z -= (this.speed + e.extra) * dt;
      const half = e.length / 2 + .3;
      const nearZ = e.z <= half && prev >= -half;
      const nearX = Math.min(oldX, this.x) < e.lane * LANE_WIDTH + 1.12 && Math.max(oldX, this.x) > e.lane * LANE_WIDTH - 1.12;
      if (!nearZ || !nearX) continue;
      if (e.kind === 'coin') {
        if (Math.abs(this.x - e.lane * LANE_WIDTH) < .75 && Math.abs(this.y + (this.slide > 0 ? .45 : .9) - e.y) < .85) { e.z = -100; this.coins++; this.onEvent('coin'); }
      } else if (e.kind === 'train' || (e.kind === 'low' && this.y < .95) || (e.kind === 'high' && this.y + (this.slide > 0 ? .65 : 1.7) > 1.05)) {
        this.phase = 'over'; this.onEvent('crash'); break;
      }
    }
    this.entities = this.entities.filter(e => e.z > -12);
  }
}
