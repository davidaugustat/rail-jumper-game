import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/__railjumper-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas id="scene"></canvas></html>',
    }),
  );
  await page.goto('http://localhost:5173/__railjumper-test');
  await page.evaluate(async () => {
    const { Game, STEP, ROOF_HEIGHT } = await import('/src/game.ts');
    const { World } = await import('/src/scene.ts');
    const { DISTRICTS, WORLD_LENGTH } = await import('/src/map.ts');
    const game = new Game();
    game.start();
    game.entities = [];
    game.routes = [];
    game.nextEncounter = 1e9;
    const world = new World(document.querySelector('canvas'));
    window.harness = { game, world, STEP, ROOF_HEIGHT, DISTRICTS, WORLD_LENGTH };
    function render() {
      world.render(game, game.elapsed);
      requestAnimationFrame(render);
    }
    render();
  });
  const roof = await page.evaluate(() => {
    const { game: g, world: w, STEP, ROOF_HEIGHT } = window.harness;
    g.entities = [
      { id: 1, kind: 'train', lane: 0, z: 25, y: 0, extra: 0, length: 28, ramp: true },
      { id: 2, kind: 'train', lane: 1, z: 39, y: 0, extra: 8, length: 34 },
    ];
    for (let i = 0; i < 90; i++) g.update(STEP);
    const climbed = g.y === ROOF_HEIGHT && g.grounded && g.phase === 'playing';
    g.jump();
    g.move(1);
    for (let i = 0; i < 144; i++) {
      g.update(STEP);
      if (g.y === ROOF_HEIGHT && g.grounded) break;
    }
    w.render(g, g.elapsed);
    const model = w.entityMeshes.get(1);
    return {
      climbed,
      landed: g.y === ROOF_HEIGHT && g.grounded,
      alive: g.phase === 'playing',
      x: g.x,
      rampPosition: model.getObjectByName('ramp').position.z,
      trainScale: model.getObjectByName('chassis').scale.z,
    };
  });
  assert.deepEqual(roof, {
    climbed: true,
    landed: true,
    alive: true,
    x: 3,
    rampPosition: 14,
    trainScale: 4,
  });
  const landmarks = await page.evaluate(() => {
    const { game: g, world: w, ROOF_HEIGHT } = window.harness;
    g.distance = 2660;
    g.y = ROOF_HEIGHT;
    w.render(g, g.elapsed);
    const tunnel = w.landmarks.find((l) => l.type === 'tunnel');
    return {
      tunnels: w.landmarks.filter((l) => l.type === 'tunnel').length,
      bridges: w.landmarks.filter((l) => l.type === 'bridge').length,
      ceiling: tunnel.group.getObjectByName('ceiling').visible,
      camera: w.camera.position.y,
      far: w.camera.far,
      fogEnd: w.scene.fog.far,
    };
  });
  assert.equal(landmarks.tunnels, 2);
  assert.equal(landmarks.bridges, 2);
  assert.equal(landmarks.ceiling, true);
  assert.ok(landmarks.camera <= 7.1);
  assert.ok(landmarks.far >= 800);
  assert.ok(landmarks.fogEnd >= 550);
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: '/tmp/railjumper-tunnel-roof.png', timeout: 60000 });
  await page.evaluate(() => {
    const { game: g, world: w } = window.harness;
    g.distance = 1850;
    w.render(g, g.elapsed);
  });
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: '/tmp/railjumper-bridge-roof.png', timeout: 60000 });
  const districts = await page.evaluate(() => {
    const { game: g, world: w, DISTRICTS, WORLD_LENGTH } = window.harness;
    const samples = DISTRICTS.map((district) => {
      g.distance = district.start + 100;
      w.render(g, g.elapsed);
      const instances = w.batches.reduce(
        (total, batch) =>
          total +
          batch.matrices.filter((matrix) => {
            const mapDistance = -matrix.elements[14];
            return mapDistance >= district.start && mapDistance < district.end;
          }).length,
        0,
      );
      return { id: district.id, calls: w.renderer.info.render.calls, instances };
    });
    return { samples, worldLength: WORLD_LENGTH };
  });
  assert.equal(districts.worldLength, 3200);
  assert.deepEqual(
    districts.samples.map((sample) => sample.id),
    ['outskirts', 'rail-yard', 'river', 'city'],
  );
  assert.ok(districts.samples.every((sample) => sample.calls < 1000));
  assert.ok(districts.samples.every((sample) => sample.instances > 1000));
  assert.ok(
    districts.samples.find((sample) => sample.id === 'rail-yard').instances >
      districts.samples.find((sample) => sample.id === 'river').instances,
  );
  if (process.env.SCREENSHOTS) {
    await page.evaluate(() => {
      const { game: g, world: w } = window.harness;
      g.distance = 1000;
      w.render(g, g.elapsed);
    });
    await page.screenshot({ path: '/tmp/railjumper-rail-yard.png', timeout: 60000 });
  }
  const horizon = await page.evaluate(() => {
    const { game: g, world: w } = window.harness;
    g.start();
    w.render(g, g.elapsed);
    return {
      distance: Math.max(...g.entities.map((e) => e.z)),
      models: w.entityMeshes.size,
      calls: w.renderer.info.render.calls,
    };
  });
  assert.ok(horizon.distance > 600);
  assert.ok(horizon.models < 350);
  assert.ok(horizon.calls < 1000);
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: '/tmp/railjumper-dense-horizon.png', timeout: 60000 });
  assert.deepEqual(errors, []);
  console.log(
    'Chromium: rendered ramp climb, passing-roof landing, enclosed tunnels, bridge, horizon and bounded models passed',
    horizon,
  );
} finally {
  await browser.close();
}
