import { chromium, firefox } from '@playwright/test';
import assert from 'node:assert/strict';
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]].filter(([name]) => !process.env.BROWSER || name === process.env.BROWSER)) {
  const browser = await engine.launch({ headless: true, ...(name === 'chromium' ? { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { ...(process.env.FIREFOX_EXECUTABLE ? { executablePath: process.env.FIREFOX_EXECUTABLE } : {}), firefoxUserPrefs: { 'webgl.force-enabled': true } }) });
  try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // Reproducible first row: both outer lanes blocked; center is safe.
  await page.addInitScript(() => { let seed = 123; Math.random = () => .45 + (((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * .1); });
  await page.goto('http://localhost:5173');
  await page.locator('#start').waitFor();
  await page.waitForTimeout(100);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.SCREENSHOTS) await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-welcome.png` });
  await page.locator('#start').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#hud').isVisible(), true);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500); await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal-title').textContent(), 'On a break.');
  const score = await page.locator('#score').textContent(); await page.waitForTimeout(200);
  assert.equal(await page.locator('#score').textContent(), score);
  await page.locator('#continue').click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  if (process.env.SCREENSHOTS) await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-playing.png` });
  await page.locator('#continue').click();
  await page.keyboard.press('ArrowRight');
  await page.locator('#modal-title').filter({ hasText: 'What a ride.' }).waitFor({ timeout: 20000 });
  assert.equal(await page.locator('#modal-title').textContent(), 'What a ride.');
  assert.equal(await page.locator('#modal').isVisible(), true);
  assert.ok(Number(await page.locator('#final-score').textContent()) > 0);
  await page.locator('#continue').click();
  assert.equal(await page.locator('#modal').isVisible(), false);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('#modal-title').textContent(), 'On a break.');
  await page.locator('#sound').click();
  await page.reload();
  assert.equal(await page.locator('#sound').getAttribute('aria-label'), 'Unmute sound');
  assert.ok(await page.evaluate(() => Number(localStorage.getItem('railrush-best'))) > 0);
  await page.setViewportSize({ width: 900, height: 700 });
  if (process.env.SCREENSHOTS) await page.screenshot({ timeout: 60000, path: `/tmp/railrush-${name}-compact.png` });
  assert.deepEqual(errors, []);
  console.log(`${name}: start, keyboard, pause, collision, restart, focus, persistence, resize passed`);
  } finally { await browser.close(); }
}
