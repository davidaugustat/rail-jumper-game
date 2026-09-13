import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const name = 'chromium';
async function swipe(client, from, to) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...from, id: 0, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...to, id: 0, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function elementsOutsideViewport(page, selectors) {
  return page.evaluate((targets) => {
    return targets.filter((selector) => {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight;
    });
  }, selectors);
}
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
    await page.screenshot({ timeout: 60000, path: `/tmp/railjumper-${name}-welcome.png` });
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
  await page.evaluate(() => {
    const game = window[Symbol.for('railjumper.game')];
    // Keep the UI-driven run active while isolating the collision scenarios.
    game.entities = [];
    game.routes = [];
    game.nextEncounter = 1e9;
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  if (process.env.SCREENSHOTS)
    await page.screenshot({ timeout: 60000, path: `/tmp/railjumper-${name}-playing.png` });
  await page.locator('#continue').click();
  await page.evaluate(() => {
    const game = window[Symbol.for('railjumper.game')];
    game.lane = 0;
    game.x = 0;
    game.moveOrigin = 0;
    game.y = 0;
    game.vy = 0;
    game.grounded = true;
    game.slide = 0;
    game.pendingSlide = false;
    game.bonkWindow = 0;
    const lane = game.lane === 1 ? 0 : game.lane + 1;
    game.entities = [{ id: 9001, kind: 'train', lane, z: 0, y: 0, extra: -game.speed, length: 28 }];
    game.move(lane - game.lane);
    for (let step = 0; step < 20; step++) game.update(1 / 120);
  });
  assert.equal(await page.evaluate(() => window[Symbol.for('railjumper.game')].phase), 'playing');
  assert.ok((await page.evaluate(() => window[Symbol.for('railjumper.game')].bonkWindow)) > 0);
  await page.evaluate(() => {
    const game = window[Symbol.for('railjumper.game')];
    game.crash();
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      phase: window[Symbol.for('railjumper.game')].phase,
      modalHidden: document.querySelector('#modal').hidden,
      title: document.querySelector('#modal-title').textContent,
    })),
    { phase: 'over', modalHidden: false, title: 'What a ride.' },
  );
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
  assert.ok((await page.evaluate(() => Number(localStorage.getItem('railjumper-best')))) > 0);
  await page.setViewportSize({ width: 900, height: 700 });
  if (process.env.SCREENSHOTS)
    await page.screenshot({ timeout: 60000, path: `/tmp/railjumper-${name}-compact.png` });
  await page.close();

  const mobile = await browser.newPage({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  const mobileErrors = [];
  mobile.on('pageerror', (e) => mobileErrors.push(e.message));
  await mobile.goto('http://localhost:5173');
  await mobile.locator('#start').waitFor();
  await mobile.evaluate(() => document.fonts.ready);
  assert.equal(await mobile.locator('.swipe-guide').isVisible(), true);
  assert.equal(await mobile.locator('.control').first().isVisible(), false);
  assert.deepEqual(
    await elementsOutsideViewport(mobile, [
      '.topbar',
      '.welcome',
      '#start',
      '.best-line',
      '.controls',
    ]),
    [],
  );
  assert.deepEqual(
    await mobile.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    })),
    { width: 320, height: 568, viewportWidth: 320, viewportHeight: 568 },
  );
  const touch = await mobile.context().newCDPSession(mobile);
  await swipe(touch, { x: 100, y: 300 }, { x: 180, y: 300 });
  assert.equal(await mobile.evaluate(() => window[Symbol.for('railjumper.game')].phase), 'ready');
  await mobile.locator('#start').click();
  await mobile.evaluate(() => {
    const game = window[Symbol.for('railjumper.game')];
    game.entities = [];
    game.routes = [];
    game.nextEncounter = 1e9;
  });
  assert.equal(await mobile.locator('.brand').isVisible(), false);
  assert.deepEqual(
    await elementsOutsideViewport(mobile, ['#sound', '#hud', '#score', '#coins', '#pause']),
    [],
  );
  await swipe(touch, { x: 100, y: 300 }, { x: 180, y: 300 });
  assert.equal(await mobile.evaluate(() => window[Symbol.for('railjumper.game')].lane), 1);
  await swipe(touch, { x: 180, y: 300 }, { x: 100, y: 300 });
  assert.equal(await mobile.evaluate(() => window[Symbol.for('railjumper.game')].lane), 0);
  await swipe(touch, { x: 100, y: 300 }, { x: 108, y: 304 });
  assert.equal(await mobile.evaluate(() => window[Symbol.for('railjumper.game')].lane), 0);
  await swipe(touch, { x: 150, y: 350 }, { x: 150, y: 270 });
  assert.deepEqual(
    await mobile.evaluate(() => {
      const game = window[Symbol.for('railjumper.game')];
      return { grounded: game.grounded, rising: game.vy > 0 };
    }),
    { grounded: false, rising: true },
  );
  await mobile.evaluate(() => {
    const game = window[Symbol.for('railjumper.game')];
    game.y = 0;
    game.vy = 0;
    game.grounded = true;
    game.slide = 0;
    game.pendingSlide = false;
  });
  await swipe(touch, { x: 150, y: 270 }, { x: 150, y: 350 });
  assert.ok((await mobile.evaluate(() => window[Symbol.for('railjumper.game')].slide)) > 0);
  await mobile.locator('#pause').click();
  assert.deepEqual(
    await elementsOutsideViewport(mobile, ['.modal-card', '#continue', '#restart', '.controls']),
    [],
  );
  await swipe(touch, { x: 100, y: 300 }, { x: 180, y: 300 });
  assert.equal(await mobile.evaluate(() => window[Symbol.for('railjumper.game')].lane), 0);
  await mobile.locator('#continue').click();
  await mobile.evaluate(() => window[Symbol.for('railjumper.game')].crash());
  assert.deepEqual(
    await elementsOutsideViewport(mobile, ['.modal-card', '.results', '#continue', '.controls']),
    [],
  );
  await mobile.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(
    await elementsOutsideViewport(mobile, ['.modal-card', '#continue', '.controls']),
    [],
  );
  if (process.env.SCREENSHOTS)
    await mobile.screenshot({ timeout: 60000, path: `/tmp/railjumper-${name}-mobile.png` });
  assert.deepEqual(mobileErrors, []);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log(
    `${name}: keyboard, touch gestures, mobile layout, pause, collision, persistence and resize passed`,
  );
} finally {
  await browser.close();
}
