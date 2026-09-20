import { describe, it, expect } from 'vitest';
import {
  Game,
  STEP,
  MAX_SPEED,
  ROOF_HEIGHT,
  ROOF_JUMP_SPEED,
  RAMP_JUMP_SPEED,
  RAMP_LENGTH,
  GENERATION_DISTANCE,
  BONK_WINDOW,
  ENCOUNTER_FAMILIES,
  distanceAt,
  type Entity,
  type Kind,
} from './game';
import { DISTRICTS, WORLD_LENGTH, districtAt } from './map';
function clean() {
  const g = new Game(() => 0.5);
  g.start();
  g.entities = [];
  g.routes = [];
  g.nextEncounter = 1e9;
  return g;
}
function tick(g: Game, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) g.update(STEP);
}
function obstacle(kind: Kind, z = 0, lane = 0, extra = 0): Entity {
  return {
    id: 1,
    kind,
    z,
    lane,
    y: kind === 'coin' ? 1 : 0,
    extra,
    length: kind === 'train' ? 28 : 0.65,
  };
}
function rng(seed: number) {
  return () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
}
function followGeneratedRoute(game: Game, seconds: number, timingOffset = 0) {
  const handled = new Set<string>();
  let maxEntities = game.entities.length;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    const due = game.routes.filter((route) => {
      const key = `${route.encounter}:${route.time}:${route.lane}:${route.action ?? ''}`;
      if (handled.has(key) || route.time + timingOffset > game.elapsed + STEP / 2) return false;
      handled.add(key);
      return true;
    });
    for (const route of due) {
      while (game.lane !== route.lane) game.move(Math.sign(route.lane - game.lane));
      if (route.action === 'jump') game.jump();
      if (route.action === 'duck') game.duck();
    }
    game.update(STEP);
    maxEntities = Math.max(maxEntities, game.entities.length);
    if (game.phase !== 'playing') {
      const nearby = game.entities
        .filter((entity) => entity.kind !== 'coin' && Math.abs(entity.z) < 45)
        .map((entity) => ({
          kind: entity.kind,
          lane: entity.lane,
          z: +entity.z.toFixed(2),
          length: +entity.length.toFixed(2),
          extra: +entity.extra.toFixed(2),
          ramp: entity.ramp,
        }));
      throw new Error(
        `crash at ${game.elapsed.toFixed(3)}s in lane ${game.lane}: ${JSON.stringify(nearby)}, routes ${JSON.stringify(game.routes.filter((route) => Math.abs(route.time - game.elapsed) < 3))}`,
      );
    }
  }
  return maxEntities;
}
describe('runner mechanics', () => {
  it('clamps lanes and allows airborne lane changes', () => {
    const g = clean();
    g.move(-1);
    g.move(-1);
    tick(g, 0.3);
    expect(g.x).toBe(-3);
    g.jump();
    g.move(1);
    tick(g, 0.2);
    expect(g.x).toBe(0);
    expect(g.y).toBeGreaterThan(0);
  });
  it('prevents double jumps and does not extend a slide on repeated down input', () => {
    const g = clean();
    g.jump();
    tick(g, 0.2);
    const vy = g.vy;
    g.jump();
    expect(g.vy).toBe(vy);
    tick(g, 1);
    g.duck();
    tick(g, 0.3);
    const slide = g.slide;
    g.duck();
    expect(g.slide).toBe(slide);
    tick(g, 0.6);
    expect(g.slide).toBe(0);
  });
  it('up immediately cancels a slide and jumps', () => {
    const g = clean();
    g.duck();
    tick(g, 0.1);
    g.jump();
    expect(g.slide).toBe(0);
    expect(g.vy).toBeGreaterThan(0);
    tick(g, 0.1);
    expect(g.y).toBeGreaterThan(0);
  });
  it('down aborts a jump with a fast descent and slides on landing', () => {
    const g = clean();
    g.jump();
    tick(g, 0.2);
    const height = g.y;
    g.duck();
    expect(g.vy).toBeLessThan(0);
    tick(g, 0.05);
    expect(g.y).toBeLessThan(height);
    tick(g, 0.15);
    expect(g.grounded).toBe(true);
    expect(g.slide).toBeGreaterThan(0);
    expect(g.pendingSlide).toBe(false);
  });
  it.each(['low', 'high', 'train'] as Kind[])(
    'ends the run on a ground collision with %s',
    (kind) => {
      const g = clean();
      g.entities = [obstacle(kind)];
      tick(g, STEP);
      expect(g.phase).toBe('over');
      const score = g.score;
      tick(g, 1);
      expect(g.score).toBe(score);
    },
  );
  it('clears low barriers by jumping and high barriers by sliding', () => {
    const g = clean();
    g.jump();
    tick(g, 0.3);
    g.entities = [obstacle('low')];
    tick(g, STEP);
    expect(g.phase).toBe('playing');
    const s = clean();
    s.duck();
    s.entities = [obstacle('high')];
    tick(s, STEP);
    expect(s.phase).toBe('playing');
  });
  it('cannot jump through train sides or slide through low barriers', () => {
    const g = clean();
    g.jump();
    tick(g, 0.3);
    g.entities = [obstacle('train')];
    tick(g, STEP);
    expect(g.phase).toBe('over');
    const s = clean();
    s.duck();
    s.entities = [obstacle('low')];
    tick(s, STEP);
    expect(s.phase).toBe('over');
  });
  it('detects a fast frontal crossing', () => {
    const g = clean();
    g.entities = [obstacle('low', 1, 0, 1000)];
    tick(g, STEP);
    expect(g.phase).toBe('over');
  });
  it('collects coins once and scores distance plus ten per coin', () => {
    const g = clean();
    g.entities = [obstacle('coin')];
    tick(g, 0.1);
    expect(g.coins).toBe(1);
    expect(g.score).toBe(Math.floor(g.distance) + 10);
  });
  it('freezes on pause and resets rooftop and cancellation state on restart', () => {
    const g = clean();
    tick(g, 1);
    g.pause();
    const d = g.distance;
    g.jump();
    g.move(1);
    g.duck();
    tick(g, 2);
    expect(g.distance).toBe(d);
    expect(g.lane).toBe(0);
    g.resume();
    tick(g, 0.1);
    expect(g.distance).toBeGreaterThan(d);
    g.y = ROOF_HEIGHT;
    g.pendingSlide = true;
    g.start();
    expect([g.distance, g.coins, g.x, g.y, g.slide, g.elapsed]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(g.grounded).toBe(true);
    expect(g.pendingSlide).toBe(false);
    expect(g.entities.length).toBeGreaterThan(0);
  });
  it('produces identical simulation at different rendering frame rates', () => {
    function simulate(fps: number) {
      const g = clean();
      g.jump();
      g.move(1);
      let accumulator = 0;
      for (let frame = 0; frame < fps * 3; frame++) {
        accumulator += 1 / fps;
        while (accumulator + 1e-10 >= STEP) {
          g.update(STEP);
          accumulator -= STEP;
        }
      }
      return [g.distance, g.x, g.y, g.score];
    }
    expect(simulate(30)).toEqual(simulate(60));
    expect(simulate(144)).toEqual(simulate(60));
  });
  it('caps speed and integrates distance continuously at the cap', () => {
    const g = clean();
    g.elapsed = 1000;
    expect(g.speed).toBe(MAX_SPEED);
    expect(distanceAt(1001) - distanceAt(1000)).toBe(MAX_SPEED);
    expect(distanceAt(80.001) - distanceAt(80)).toBeCloseTo(MAX_SPEED * 0.001);
  });
});
describe('ramps and moving train roofs', () => {
  it.each([0, 8])('runs up a ramp onto a train moving at extra speed %s', (extra) => {
    const g = clean();
    g.entities = [{ ...obstacle('train', 14 + RAMP_LENGTH + 1, 0, extra), ramp: true }];
    let previousY = 0,
      climbed = false;
    for (let i = 0; i < 160; i++) {
      g.update(STEP);
      expect(g.phase).toBe('playing');
      if (g.y > 0) climbed = true;
      if (g.y === ROOF_HEIGHT) break;
      expect(g.y).toBeGreaterThanOrEqual(previousY);
      previousY = g.y;
    }
    expect(climbed).toBe(true);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.grounded).toBe(true);
  });
  it.each([0.1, 3, 7, 9.8])('jumps safely from %.1f meters up a ramp', (rampProgress) => {
    const g = clean();
    const train = { ...obstacle('train', 14 + RAMP_LENGTH - rampProgress), ramp: true };
    g.entities = [train];
    g.y = (ROOF_HEIGHT * rampProgress) / RAMP_LENGTH;
    g.grounded = true;
    g.jump();
    expect(g.vy).toBe(RAMP_JUMP_SPEED);
    tick(g, 1.5);
    expect(g.phase).toBe('playing');
  });
  it('lands diagonally on a ramp and crosses onto its roof without crashing', () => {
    const g = clean();
    const train = { ...obstacle('train', 18.3, 1, 8), ramp: true };
    g.entities = [train];
    g.x = 1.75;
    g.lane = 1;
    g.moveOrigin = 0;
    g.y = 2.2;
    g.grounded = false;
    g.vy = -4;
    let touchedRamp = false;
    for (let i = 0; i < 180; i++) {
      g.update(STEP);
      expect(g.phase).toBe('playing');
      if (g.grounded && g.y > 0 && g.y < ROOF_HEIGHT) touchedRamp = true;
      if (touchedRamp && g.grounded && g.y === ROOF_HEIGHT) break;
    }
    expect(touchedRamp).toBe(true);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.rampAccessTrainId).toBe(train.id);
  });
  it('bonks and bounces back when entering the high side of a ramp', () => {
    const g = clean();
    g.entities = [{ ...obstacle('train', 17, 1, -18), ramp: true }];
    g.move(1);
    tick(g, 0.17);
    expect(g.phase).toBe('playing');
    expect(g.lane).toBe(0);
    expect(g.bonkWindow).toBeGreaterThan(0);
  });
  it('jumps from a stationary roof onto an adjacent passing train', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train', 0), { ...obstacle('train', 19, 1, 8), id: 2, length: 34 }];
    g.jump();
    g.move(1);
    tick(g, 0.77);
    expect(g.phase).toBe('playing');
    expect(g.x).toBe(3);
    expect(g.y).toBeGreaterThan(ROOF_HEIGHT);
    expect(g.grounded).toBe(false);
    tick(g, 0.2);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.grounded).toBe(true);
  });
  it('lands when a passing train nose moves beneath the runner at touchdown', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train', 0), { ...obstacle('train', 42.25, 1, 8), id: 2, length: 34 }];
    g.jump();
    g.move(1);
    for (let i = 0; i < 140 && g.phase === 'playing' && !g.grounded; i++) g.update(STEP);
    expect(g.phase).toBe('playing');
    expect(g.x).toBe(3);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.grounded).toBe(true);
  });
  it('forgives a slightly late passing roof at touchdown', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train', 0), { ...obstacle('train', 42.8, 1, 8), id: 2, length: 34 }];
    g.jump();
    g.move(1);
    for (let i = 0; i < 140 && g.phase === 'playing' && !g.grounded; i++) g.update(STEP);
    expect(g.phase).toBe('playing');
    expect(g.x).toBe(3);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.grounded).toBe(true);
  });
  it('gives roof jumps a longer arc than ground jumps', () => {
    const ground = clean();
    ground.jump();
    expect(ground.vy).toBeLessThan(ROOF_JUMP_SPEED);
    tick(ground, 0.8);
    expect(ground.grounded).toBe(true);
    const roof = clean();
    roof.y = ROOF_HEIGHT;
    roof.jump();
    expect(roof.vy).toBe(ROOF_JUMP_SPEED);
    tick(roof, 0.8);
    expect(roof.y).toBeGreaterThan(ROOF_HEIGHT);
    expect(roof.grounded).toBe(false);
  });
  it('fast-drops onto a roof and can jump out of the resulting slide', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train', 6)];
    g.jump();
    tick(g, 0.2);
    g.duck();
    tick(g, 0.2);
    expect(g.y).toBe(ROOF_HEIGHT);
    expect(g.slide).toBeGreaterThan(0);
    g.jump();
    tick(g, 0.1);
    expect(g.y).toBeGreaterThan(ROOF_HEIGHT);
    expect(g.slide).toBe(0);
  });
  it('falls back to the tracks after running off a roof', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [obstacle('train', -13)];
    tick(g, 0.75);
    expect(g.phase).toBe('playing');
    expect(g.y).toBe(0);
    expect(g.grounded).toBe(true);
  });
  it('collects roof coins and passes above ground barriers', () => {
    const g = clean();
    g.y = ROOF_HEIGHT;
    g.entities = [
      obstacle('train', 0),
      { ...obstacle('coin'), id: 2, y: ROOF_HEIGHT + 0.9 },
      { ...obstacle('high'), id: 3 },
    ];
    tick(g, STEP);
    expect(g.phase).toBe('playing');
    expect(g.coins).toBe(1);
  });
  it('does not teleport a falling player through a train body onto its roof', () => {
    const g = clean();
    g.y = 2;
    g.grounded = false;
    g.vy = -2;
    g.entities = [obstacle('train')];
    tick(g, STEP);
    expect(g.phase).toBe('over');
  });
});
describe('lateral bonks', () => {
  function sideHit(game: Game, kind: 'train' | 'low' = 'train') {
    game.entities = [obstacle(kind, 0, 1, -game.speed)];
    game.move(1);
    tick(game, 0.12);
  }
  it.each(['train', 'low'] as const)(
    'survives the first side impact with a %s and bounces back',
    (kind) => {
      const g = clean();
      let event = '';
      g.onEvent = (value) => {
        event = value;
      };
      sideHit(g, kind);
      expect(g.phase).toBe('playing');
      expect(g.lane).toBe(0);
      expect(g.x).toBe(0);
      expect(g.bonkWindow).toBeGreaterThan(BONK_WINDOW - 0.2);
      expect(g.bonkFlash).toBeGreaterThan(0);
      expect(event).toBe('bonk');
    },
  );
  it('ends the run on a second side impact during the ten-second window', () => {
    const g = clean();
    sideHit(g);
    expect(g.phase).toBe('playing');
    sideHit(g, 'low');
    expect(g.phase).toBe('over');
  });
  it('allows another warning after ten seconds without a side impact', () => {
    const g = clean();
    sideHit(g);
    g.entities = [];
    tick(g, BONK_WINDOW + 0.1);
    expect(g.bonkWindow).toBe(0);
    sideHit(g);
    expect(g.phase).toBe('playing');
    expect(g.bonkWindow).toBeGreaterThan(0);
  });
  it('still ends immediately on a frontal impact during or outside the warning window', () => {
    const g = clean();
    sideHit(g);
    g.entities = [obstacle('train')];
    tick(g, STEP);
    expect(g.phase).toBe('over');
    const fresh = clean();
    fresh.entities = [obstacle('low')];
    tick(fresh, STEP);
    expect(fresh.phase).toBe('over');
  });
});
describe('district encounter generation', () => {
  it('shares a 3.2 km four-district loop with rendering', () => {
    expect(WORLD_LENGTH).toBe(3200);
    expect(DISTRICTS.map((district) => district.name)).toEqual([
      'Green outskirts',
      'Rail yard',
      'River crossing',
      'City and tunnel corridor',
    ]);
    expect(districtAt(0).id).toBe('outskirts');
    expect(districtAt(801).id).toBe('rail-yard');
    expect(districtAt(1700).id).toBe('river');
    expect(districtAt(2700).id).toBe('city');
    expect(districtAt(WORLD_LENGTH + 1).id).toBe('outskirts');
  });
  it('prefills the horizon with varied encounters, moving trains, ramps, and action routes', () => {
    const games = [12, 23, 41, 55, 71].map((seed) => {
      const game = new Game(rng(seed));
      game.start();
      return game;
    });
    const entities = games.flatMap((game) => game.entities);
    const routes = games.flatMap((game) => game.routes);
    const families = new Set(games.flatMap((game) => game.encounters.map((e) => e.family)));
    expect(Math.max(...games[0].entities.map((e) => e.z))).toBeGreaterThan(
      GENERATION_DISTANCE - 50,
    );
    expect(families.size).toBeGreaterThanOrEqual(8);
    expect(entities.filter((e) => e.kind === 'train' && e.ramp).length).toBeGreaterThan(1);
    expect(entities.some((e) => e.kind === 'train' && e.extra > 0)).toBe(true);
    expect(routes.some((route) => route.action === 'jump')).toBe(true);
    expect(routes.some((route) => route.action === 'duck')).toBe(true);
    expect(routes.some((route) => route.surface === 'roof')).toBe(true);
  });
  it('keeps every roof-height coin on a matching train carriage', () => {
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = new Game(rng(seed));
      g.start();
      const roofCoins = g.entities.filter(
        (entity) => entity.kind === 'coin' && entity.y > ROOF_HEIGHT + 0.5,
      );
      for (const coin of roofCoins) {
        checked++;
        const carrier = g.entities.find(
          (entity) =>
            entity.kind === 'train' &&
            entity.lane === coin.lane &&
            entity.extra === coin.extra &&
            Math.abs(entity.z - coin.z) <= entity.length / 2,
        );
        expect(carrier, `unsupported roof coin at z=${coin.z.toFixed(1)}`).toBeDefined();
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('does not leave fifty-meter gaps without a visible hazard', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Game(rng(seed));
      g.start();
      const hazards = g.entities
        .filter((entity) => entity.kind !== 'coin' && entity.z > 150 && entity.z < 560)
        .sort((a, b) => a.z - b.z);
      let maximumGap = 0;
      let gapPair: Entity[] = [];
      for (let index = 1; index < hazards.length; index++) {
        const previous = hazards[index - 1];
        const current = hazards[index];
        const gap = current.z - current.length / 2 - (previous.z + previous.length / 2);
        if (gap > maximumGap) {
          maximumGap = gap;
          gapPair = [previous, current];
        }
      }
      expect(maximumGap, `seed ${seed}: ${JSON.stringify(gapPair)}`).toBeLessThan(50);
    }
  });
  it('leaves room for the two-lane escape between two-stage trains', () => {
    const g = new Game(rng(8));
    g.start();
    const encounter = g.encounters.find(
      (candidate) => candidate.family === 'two-stage-lane-change',
    )!;
    const firstCenter = distanceAt(encounter.start + 0.75);
    const trains = g.entities
      .filter((entity) => entity.kind === 'train' && entity.extra === 0)
      .sort((a, b) => a.z - b.z);
    const firstIndex = trains.findIndex((train) => Math.abs(train.z - firstCenter) < 0.001);
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    const first = trains[firstIndex];
    const second = trains[firstIndex + 1];
    const clearGap = second.z - second.length / 2 - (first.z + first.length / 2);

    expect(clearGap).toBeGreaterThan(12);
  });
  it('oncoming trains stay aligned to scheduled encounters through acceleration', () => {
    const g = clean();
    const e = g.add('train', 1, 10, { extra: 8 });
    tick(g, 10);
    expect(e.z).toBeCloseTo(0, 7);
    expect(g.phase).toBe('playing');
  });
  it('keeps a reachable route and bounded object counts for two complete world loops', () => {
    const coverage = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const g = new Game(rng(seed));
      g.start();
      const maxEntities = followGeneratedRoute(g, 285);
      g.encounters.forEach((encounter) =>
        coverage.add(`${encounter.family}:${encounter.entryLane}:${encounter.mirrored}`),
      );
      expect(maxEntities).toBeLessThan(350);
      expect(g.distance).toBeGreaterThan(6400);
    }
    for (const family of ENCOUNTER_FAMILIES)
      for (const lane of [-1, 0, 1])
        for (const mirrored of [false, true])
          expect(coverage).toContain(`${family}:${lane}:${mirrored}`);
  }, 15_000);
  it.each([-0.05, 0.05])('tolerates route inputs offset by %s seconds', (offset) => {
    const g = new Game(rng(73));
    g.start();
    followGeneratedRoute(g, 70, offset);
    expect(g.phase).toBe('playing');
  });
  it('uses a safe fallback when bounded candidate validation rejects every choice', () => {
    const g = new Game(rng(5));
    g.candidateFilter = () => false;
    g.start();
    expect(g.rejectedCandidates).toBeGreaterThan(0);
    expect(g.fallbackCount).toBeGreaterThan(0);
    expect(g.encounters.every((encounter) => encounter.fallback)).toBe(true);
    followGeneratedRoute(g, 30);
  });
  it('is deterministic, varies between seeds, and excludes the three recent families', () => {
    const sequence = (seed: number) => {
      const g = new Game(rng(seed));
      g.start();
      return g.encounters.map((encounter) => [
        encounter.family,
        encounter.mirrored,
        encounter.entryLane,
        encounter.exitLane,
      ]);
    };
    expect(sequence(91)).toEqual(sequence(91));
    expect(sequence(91)).not.toEqual(sequence(92));
    const families = sequence(93).map(([family]) => family);
    families.forEach((family, index) => {
      expect(families.slice(Math.max(0, index - 3), index)).not.toContain(family);
    });
  });
  it('reaches every encounter family and varies coin clusters, heights, and gaps', () => {
    const seen = new Set<string>();
    const clusterSizes = new Set<number>();
    const heights = new Set<number>();
    const gaps = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const g = new Game(rng(seed));
      g.start();
      g.encounters.forEach((encounter) => seen.add(encounter.family));
      const coins = g.entities.filter((entity) => entity.kind === 'coin').sort((a, b) => a.z - b.z);
      let cluster = 1;
      for (let index = 0; index < coins.length; index++) {
        heights.add(+coins[index].y.toFixed(1));
        if (index === 0) continue;
        const gap = +(coins[index].z - coins[index - 1].z).toFixed(1);
        gaps.add(gap);
        if (gap < 6) cluster++;
        else {
          clusterSizes.add(cluster);
          cluster = 1;
        }
      }
      clusterSizes.add(cluster);
    }
    expect(seen).toEqual(new Set(ENCOUNTER_FAMILIES));
    expect(clusterSizes.size).toBeGreaterThan(3);
    expect(heights.size).toBeGreaterThan(4);
    expect(gaps.size).toBeGreaterThan(8);
  });
});
