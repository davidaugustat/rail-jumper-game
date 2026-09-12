import { describe, it, expect } from 'vitest';
import { Game, STEP, MAX_SPEED, ROOF_HEIGHT, RAMP_LENGTH, GENERATION_DISTANCE, distanceAt, type Entity, type Kind } from './game';
function clean() { const g = new Game(() => .5); g.start(); g.entities = []; g.routes = []; g.nextEncounter = 1e9; return g; }
function tick(g: Game, seconds: number) { for (let i = 0; i < Math.round(seconds / STEP); i++) g.update(STEP); }
function obstacle(kind: Kind, z = 0, lane = 0, extra = 0): Entity { return { id: 1, kind, z, lane, y: kind === 'coin' ? 1 : 0, extra, length: kind === 'train' ? 28 : .65 }; }
function rng(seed: number) { return () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32); }
describe('runner mechanics', () => {
  it('clamps lanes and allows airborne lane changes', () => { const g = clean(); g.move(-1); g.move(-1); tick(g, .3); expect(g.x).toBe(-3); g.jump(); g.move(1); tick(g, .2); expect(g.x).toBe(0); expect(g.y).toBeGreaterThan(0); });
  it('prevents double jumps and does not extend a slide on repeated down input', () => { const g = clean(); g.jump(); tick(g, .2); const vy = g.vy; g.jump(); expect(g.vy).toBe(vy); tick(g, 1); g.duck(); tick(g,.3); const slide = g.slide; g.duck(); expect(g.slide).toBe(slide); tick(g,.6); expect(g.slide).toBe(0); });
  it('up immediately cancels a slide and jumps', () => { const g = clean(); g.duck(); tick(g,.1); g.jump(); expect(g.slide).toBe(0); expect(g.vy).toBeGreaterThan(0); tick(g,.1); expect(g.y).toBeGreaterThan(0); });
  it('down aborts a jump with a fast descent and slides on landing', () => { const g = clean(); g.jump(); tick(g,.2); const height = g.y; g.duck(); expect(g.vy).toBeLessThan(0); tick(g,.05); expect(g.y).toBeLessThan(height); tick(g,.15); expect(g.grounded).toBe(true); expect(g.slide).toBeGreaterThan(0); expect(g.pendingSlide).toBe(false); });
  it.each(['low', 'high', 'train'] as Kind[])('ends the run on a ground collision with %s', kind => { const g = clean(); g.entities = [obstacle(kind)]; tick(g, STEP); expect(g.phase).toBe('over'); const score = g.score; tick(g, 1); expect(g.score).toBe(score); });
  it('clears low barriers by jumping and high barriers by sliding', () => { const g = clean(); g.jump(); tick(g, .3); g.entities = [obstacle('low')]; tick(g, STEP); expect(g.phase).toBe('playing'); const s = clean(); s.duck(); s.entities = [obstacle('high')]; tick(s, STEP); expect(s.phase).toBe('playing'); });
  it('cannot jump through train sides or slide through low barriers', () => { const g = clean(); g.jump(); tick(g, .3); g.entities = [obstacle('train')]; tick(g, STEP); expect(g.phase).toBe('over'); const s = clean(); s.duck(); s.entities = [obstacle('low')]; tick(s, STEP); expect(s.phase).toBe('over'); });
  it('detects fast crossing and collisions during lane transitions', () => { const g = clean(); g.entities = [obstacle('low', 1, 0, 1000)]; tick(g, STEP); expect(g.phase).toBe('over'); const s = clean(); s.move(1); tick(s, .12); s.entities = [obstacle('train', 0, 1)]; tick(s, STEP); expect(s.phase).toBe('over'); });
  it('collects coins once and scores distance plus ten per coin', () => { const g = clean(); g.entities = [obstacle('coin')]; tick(g, .1); expect(g.coins).toBe(1); expect(g.score).toBe(Math.floor(g.distance) + 10); });
  it('freezes on pause and resets rooftop and cancellation state on restart', () => { const g = clean(); tick(g, 1); g.pause(); const d = g.distance; g.jump(); g.move(1); g.duck(); tick(g, 2); expect(g.distance).toBe(d); expect(g.lane).toBe(0); g.resume(); tick(g,.1); expect(g.distance).toBeGreaterThan(d); g.y = ROOF_HEIGHT; g.pendingSlide = true; g.start(); expect([g.distance,g.coins,g.x,g.y,g.slide,g.elapsed]).toEqual([0,0,0,0,0,0]); expect(g.grounded).toBe(true); expect(g.pendingSlide).toBe(false); expect(g.entities.length).toBeGreaterThan(0); });
  it('produces identical simulation at different rendering frame rates', () => {
    function simulate(fps: number) { const g = clean(); g.jump(); g.move(1); let accumulator = 0; for (let frame = 0; frame < fps * 3; frame++) { accumulator += 1 / fps; while (accumulator + 1e-10 >= STEP) { g.update(STEP); accumulator -= STEP; } } return [g.distance,g.x,g.y,g.score]; }
    expect(simulate(30)).toEqual(simulate(60)); expect(simulate(144)).toEqual(simulate(60));
  });
  it('caps speed and integrates distance continuously at the cap', () => { const g = clean(); g.elapsed = 1000; expect(g.speed).toBe(MAX_SPEED); expect(distanceAt(1001) - distanceAt(1000)).toBe(MAX_SPEED); expect(distanceAt(80.001) - distanceAt(80)).toBeCloseTo(MAX_SPEED * .001); });
});
describe('ramps and moving train roofs', () => {
  it.each([0, 8])('runs up a ramp onto a train moving at extra speed %s', extra => {
    const g = clean(); g.entities = [{ ...obstacle('train', 14 + RAMP_LENGTH + 1, 0, extra), ramp: true }];
    let previousY = 0, climbed = false;
    for (let i = 0; i < 160; i++) { g.update(STEP); expect(g.phase).toBe('playing'); if (g.y > 0) climbed = true; if (g.y === ROOF_HEIGHT) break; expect(g.y).toBeGreaterThanOrEqual(previousY); previousY = g.y; }
    expect(climbed).toBe(true); expect(g.y).toBe(ROOF_HEIGHT); expect(g.grounded).toBe(true);
  });
  it('cannot enter the high side of a ramp from ground level', () => { const g = clean(); g.entities = [{ ...obstacle('train',17,1), ramp:true }]; g.move(1); tick(g,.17); expect(g.phase).toBe('over'); });
  it('jumps from a stationary roof onto an adjacent passing train', () => {
    const g = clean(); g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train',0), {...obstacle('train',6,1,8),id:2,length:34}];
    g.jump(); g.move(1); tick(g,.77);
    expect(g.phase).toBe('playing'); expect(g.x).toBe(3); expect(g.y).toBe(ROOF_HEIGHT); expect(g.grounded).toBe(true);
  });
  it('fast-drops onto a roof and can jump out of the resulting slide', () => {
    const g = clean(); g.y = ROOF_HEIGHT; g.entities = [obstacle('train',6)]; g.jump(); tick(g,.2); g.duck(); tick(g,.2); expect(g.y).toBe(ROOF_HEIGHT); expect(g.slide).toBeGreaterThan(0); g.jump(); tick(g,.1); expect(g.y).toBeGreaterThan(ROOF_HEIGHT); expect(g.slide).toBe(0);
  });
  it('falls back to the tracks after running off a roof', () => { const g = clean(); g.y = ROOF_HEIGHT; g.entities = [obstacle('train',-13)]; tick(g,.75); expect(g.phase).toBe('playing'); expect(g.y).toBe(0); expect(g.grounded).toBe(true); });
  it('collects roof coins and passes above ground barriers', () => { const g = clean(); g.y = ROOF_HEIGHT; g.entities = [obstacle('train',0),{...obstacle('coin'),id:2,y:ROOF_HEIGHT+.9},{...obstacle('high'),id:3}]; tick(g,STEP); expect(g.phase).toBe('playing'); expect(g.coins).toBe(1); });
  it('does not teleport a falling player through a train body onto its roof', () => { const g = clean(); g.y = 2; g.grounded = false; g.vy = -2; g.entities = [obstacle('train')]; tick(g,STEP); expect(g.phase).toBe('over'); });
});
describe('denser, distant obstacle generation', () => {
  it('prefills the horizon with close barrier rows and paired rooftop routes', () => {
    const g = new Game(rng(12)); g.start();
    expect(Math.max(...g.entities.map(e=>e.z))).toBeGreaterThan(GENERATION_DISTANCE - 50);
    expect(g.entities.filter(e=>e.kind==='train'&&e.ramp).length).toBeGreaterThan(1);
    expect(g.entities.some(e=>e.kind==='train'&&e.extra>0)).toBe(true);
    const rows = g.routes.filter(r=>!r.rooftop);
    expect(rows[1].time - rows[0].time).toBeLessThan(1.11);
    expect(g.entities.filter(e=>e.kind!=='coin').length).toBeGreaterThan(35);
  });
  it('oncoming trains stay aligned to scheduled encounters through acceleration', () => {
    const g = clean(); const e = g.add('train',1,10,{extra:8}); tick(g,10); expect(e.z).toBeCloseTo(0,7); expect(g.phase).toBe('playing');
  });
  it('keeps a reachable route and bounded object counts across many long runs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = new Game(rng(seed)); g.start(); let maxEntities = 0;
      for (let i = 0; i < 120 * 180; i++) {
        const next = g.routes.find(r=>r.time >= g.elapsed - .15);
        if (next && next.time < g.elapsed + .5) g.lane = next.safe;
        g.update(STEP); maxEntities = Math.max(maxEntities,g.entities.length);
        if (g.phase !== 'playing') throw new Error(`seed ${seed}, time ${g.elapsed.toFixed(3)}, lane ${g.lane}, next ${JSON.stringify(next)}`);
      }
      expect(maxEntities).toBeLessThan(350); expect(g.distance).toBeGreaterThan(4500);
    }
  });
});
