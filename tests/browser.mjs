import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const name = 'chromium';
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Reproducible obstacle choices while keeping Three.js material IDs unique.
  await page.addInitScript(() => {
    let seed = 123;
    Math.random = () => 0.45 + ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 0.1;
  });
  await page.goto('http://localhost:5173');
  await page.locator('#start').waitFor();
  assert.equal(
    await page.locator('.game-frame').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width === innerWidth && rect.height === innerHeight;
    }),
    true,
  );
  assert.equal(await page.locator('.controls').isVisible(), true);
  for (const removed of [
    'Suncoast Line',
    'Endless Mode',
    'All Good Ahead',
    'The Endless Summer Run',
    'Find your rhythm',
    'The basics',
  ]) {
    assert.equal(
      (await page.locator('body').innerText()).toLowerCase().includes(removed.toLowerCase()),
      false,
    );
  }
  assert.equal(await page.locator('#pause svg').count(), 1);
  assert.equal(await page.locator('#sound svg').count(), 1);
  await page.waitForTimeout(100);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.SCREENSHOTS)
    await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-welcome.png` });
  await page.locator('#start').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#hud').isVisible(), true);
  assert.deepEqual(
    await page.locator('.controls').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
      };
    }),
    { visibility: 'hidden', opacity: '0', pointerEvents: 'none' },
  );
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal-title').textContent(), 'On a break.');
  assert.equal(await page.locator('.controls').isVisible(), true);
  const score = await page.locator('#score').textContent();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#score').textContent(), score);
  await page.locator('#continue').click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  if (process.env.SCREENSHOTS)
    await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-playing.png` });
  await page.locator('#continue').click();
  await page.evaluate(() => {
    const game = window[Symbol.for('railrush.game')];
    // Isolate this collision test from the animated game's generated obstacles.
    game.start();
    game.entities = [];
    game.routes = [];
    game.nextEncounter = 1e9;
    const lane = game.lane === 1 ? 0 : game.lane + 1;
    game.entities = [{ id: 9001, kind: 'train', lane, z: 0, y: 0, extra: -game.speed, length: 28 }];
    game.move(lane - game.lane);
    for (let step = 0; step < 20; step++) game.update(1 / 120);
  });
  assert.equal(await page.evaluate(() => window[Symbol.for('railrush.game')].phase), 'playing');
  assert.ok((await page.evaluate(() => window[Symbol.for('railrush.game')].bonkWindow)) > 0);
  await page.evaluate(() => {
    const game = window[Symbol.for('railrush.game')];
    const lane = game.lane === 1 ? 0 : game.lane + 1;
    game.entities = [{ id: 9002, kind: 'low', lane, z: 0, y: 0, extra: -game.speed, length: 0.65 }];
    game.move(lane - game.lane);
    for (let step = 0; step < 20; step++) game.update(1 / 120);
  });
  await page
    .locator('#modal-title')
    .filter({ hasText: 'What a ride.' })
    .waitFor({ timeout: 20000 });
  assert.equal(await page.locator('#modal-title').textContent(), 'What a ride.');
  assert.equal(await page.locator('#modal').isVisible(), true);
  assert.equal(await page.locator('.controls').isVisible(), true);
  assert.ok(Number(await page.locator('#final-score').textContent()) > 0);
  await page.locator('#continue').click();
  assert.equal(await page.locator('#modal').isVisible(), false);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#modal-title').textContent(), 'On a break.');
  await page.locator('#sound').click();
  assert.equal(await page.locator('#sound .mute-stroke').count(), 1);
  await page.reload();
  assert.equal(await page.locator('#sound').getAttribute('aria-label'), 'Unmute sound');
  assert.ok((await page.evaluate(() => Number(localStorage.getItem('railrush-best')))) > 0);
  await page.setViewportSize({ width: 900, height: 700 });
  if (process.env.SCREENSHOTS)
    await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-compact.png` });
  assert.deepEqual(errors, []);
  console.log(
    `${name}: start, keyboard, pause, collision, restart, focus, persistence, resize passed`,
  );
} finally {
  await browser.close();
}
