import { describe, it, expect } from 'vitest';
import { Game, STEP, MAX_SPEED, pattern, type Entity, type Kind } from './game';
function clean() { const g = new Game(() => .5); g.start(); g.spawnClock = 1e9; return g; }
function tick(g: Game, seconds: number) { for (let i = 0; i < Math.round(seconds / STEP); i++) g.update(STEP); }
function obstacle(kind: Kind, z = 0, lane = 0, extra = 0): Entity { return { id: 1, kind, z, lane, y: kind === 'coin' ? 1 : 0, extra, length: kind === 'train' ? 7 : .65 }; }
describe('runner mechanics', () => {
  it('clamps lanes and allows airborne lane changes', () => { const g = clean(); g.move(-1); g.move(-1); tick(g, .3); expect(g.x).toBe(-3); g.jump(); g.move(1); tick(g, .2); expect(g.x).toBe(0); expect(g.y).toBeGreaterThan(0); });
  it('prevents double jumps and jumping while sliding', () => { const g = clean(); g.jump(); tick(g, .2); const vy = g.vy; g.jump(); g.duck(); expect(g.vy).toBe(vy); expect(g.slide).toBe(0); tick(g, 1); g.duck(); g.jump(); expect(g.vy).toBe(0); tick(g, .4); const slide = g.slide; g.duck(); expect(g.slide).toBe(slide); tick(g, .5); expect(g.slide).toBe(0); });
  it.each(['low', 'high', 'train'] as Kind[])('ends the run on a standing collision with %s', kind => { const g = clean(); g.entities = [obstacle(kind)]; tick(g, STEP); expect(g.phase).toBe('over'); const score = g.score; tick(g, 1); expect(g.score).toBe(score); });
  it('clears low barriers by jumping and high barriers by sliding', () => { const g = clean(); g.jump(); tick(g, .3); g.entities = [obstacle('low')]; tick(g, STEP); expect(g.phase).toBe('playing'); const s = clean(); s.duck(); s.entities = [obstacle('high')]; tick(s, STEP); expect(s.phase).toBe('playing'); });
  it('cannot jump through trains or slide through low barriers', () => { const g = clean(); g.jump(); tick(g, .3); g.entities = [obstacle('train')]; tick(g, STEP); expect(g.phase).toBe('over'); const s = clean(); s.duck(); s.entities = [obstacle('low')]; tick(s, STEP); expect(s.phase).toBe('over'); });
  it('detects high speed crossing and collisions during lane transitions', () => { const g = clean(); g.entities = [obstacle('low', 1, 0, 1000)]; tick(g, STEP); expect(g.phase).toBe('over'); const s = clean(); s.move(1); tick(s, .12); s.entities = [obstacle('train', 0, 1)]; tick(s, STEP); expect(s.phase).toBe('over'); });
  it('collects coins once and scores distance plus ten per coin', () => { const g = clean(); g.entities = [obstacle('coin')]; tick(g, .1); expect(g.coins).toBe(1); expect(g.score).toBe(Math.floor(g.distance) + 10); });
  it('freezes on pause and resets all run state on restart', () => { const g = clean(); tick(g, 1); g.pause(); const d = g.distance; g.jump(); g.move(1); tick(g, 2); expect(g.distance).toBe(d); expect(g.lane).toBe(0); g.resume(); tick(g, .1); expect(g.distance).toBeGreaterThan(d); g.start(); expect([g.distance, g.coins, g.x, g.y, g.slide, g.elapsed]).toEqual([0, 0, 0, 0, 0, 0]); expect(g.entities).toEqual([]); });
  it('produces identical simulation results at different rendering frame rates', () => {
    function simulate(fps: number) {
      const g = clean(); g.jump(); g.move(1); let accumulator = 0;
      for (let frame = 0; frame < fps * 3; frame++) {
        accumulator += 1 / fps;
        while (accumulator + 1e-10 >= STEP) { g.update(STEP); accumulator -= STEP; }
      }
      return [g.distance, g.x, g.y, g.score];
    }
    expect(simulate(30)).toEqual(simulate(60)); expect(simulate(144)).toEqual(simulate(60));
  });
  it('caps difficulty', () => { const g = clean(); g.elapsed = 1000; expect(g.speed).toBe(MAX_SPEED); });
  it('every generated row has a safe lane', () => { let seed = 44; const rng = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32); for (let i = 0; i < 1000; i++) { const p = pattern(rng); expect(p.obstacles.every(o => o.lane !== p.safe)).toBe(true); expect(p.obstacles.length).toBeLessThan(3); } });
  it('supports an extended safe run with bounded entities and reachable row transitions', () => {
    let seed = 7; const g = new Game(() => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32)); g.start(); let maxEntities = 0;
    for (let i = 0; i < 120 * 180; i++) {
      const next = g.entities.filter(e => e.kind !== 'coin' && e.z > -e.length / 2 - .3).sort((a, b) => a.z / (g.speed + a.extra) - b.z / (g.speed + b.extra))[0];
      if (next) { const near = g.entities.filter(e => e.kind !== 'coin' && Math.abs(e.z / (g.speed + e.extra) - next.z / (g.speed + next.extra)) < .7); const safe = [-1, 0, 1].find(l => near.every(e => e.lane !== l)); if (safe !== undefined) g.lane = safe; }
      g.update(STEP); maxEntities = Math.max(maxEntities, g.entities.length); expect(g.phase).toBe('playing');
    }
    expect(maxEntities).toBeLessThan(40); expect(g.distance).toBeGreaterThan(3000);
  });
});
