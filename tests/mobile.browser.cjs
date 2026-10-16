// Optional end-to-end checks; the normal unit tests need no browser packages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require(process.env.ER_PLAYWRIGHT_MODULE || 'playwright');
const core = require('../src/core.js');
const catalog = require('../src/catalog.json');

const baseUrl = process.env.ER_BROWSER_URL || 'http://127.0.0.1:4173';
const output = path.resolve(__dirname, '../test-output/mobile');
const sizes = [
  [320, 568],
  [360, 800],
  [390, 844],
  [430, 932],
  [600, 800],
  [768, 1024],
  [844, 390],
  [1024, 768],
  [1280, 800],
];
const engines = (process.env.ER_BROWSER_ENGINES || 'chromium,webkit,firefox').split(',');
const sample = Buffer.from(core.demo(catalog));
fs.mkdirSync(output, { recursive: true });
let stage = '';

async function checkLayout(page, label) {
  const expected = page.viewportSize().width;
  const report = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('button,input,select')].filter(
      element =>
        element.getClientRects().length &&
        !element.matches(':disabled') &&
        !element.closest('dialog:not([open])'),
    );
    return {
      width: document.documentElement.scrollWidth,
      smallButtons: visible
        .filter(element => element.matches('button'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width < 43.5 || rect.height < 43.5;
        })
        .map(element => element.id || element.textContent.trim()),
      smallText: visible
        .filter(element => element.matches('input:not([type=checkbox]):not([type=file]),select'))
        .filter(element => parseFloat(getComputedStyle(element).fontSize) < 16)
        .map(element => element.id || element.name),
    };
  });
  assert.ok(
    report.width <= expected + 1,
    `${label}: horizontal page overflow (${report.width} > ${expected})`,
  );
  assert.deepEqual(report.smallButtons, [], `${label}: touch targets smaller than 44px`);
  assert.deepEqual(report.smallText, [], `${label}: small form text`);
}

async function checkDialog(page, selector) {
  const geometry = await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect(),
      viewport = window.visualViewport;
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      height: viewport?.height || innerHeight,
      offset: viewport?.offsetTop || 0,
      width: innerWidth,
    };
  });
  assert.ok(
    geometry.top >= geometry.offset - 1 && geometry.bottom <= geometry.offset + geometry.height + 1,
    `${selector}: dialog is outside the visible viewport: ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.left >= 0 && geometry.right <= geometry.width + 1,
    `${selector}: horizontal overflow`,
  );
}

async function choose(page, kind, query, name, ordinal = 0) {
  await page
    .getByRole('button', { name: `Choose ${kind}`, exact: true })
    .nth(ordinal)
    .tap();
  await page.locator('#catalog-picker').waitFor();
  assert.notEqual(
    await page.evaluate(() => document.activeElement.id),
    'catalog-picker-filter',
    'Chooser should not open the mobile keyboard automatically',
  );
  await page.locator('#catalog-picker-filter').fill(query);
  await checkDialog(page, '#catalog-picker');
  await page.locator('#catalog-picker-options').getByText(name, { exact: true }).tap();
  await page.locator('#catalog-picker').waitFor({ state: 'detached' });
}

async function runEngine(engine) {
  const browser = await playwright[engine].launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      hasTouch: true,
      ...(engine === 'firefox' ? {} : { isMobile: true }),
      deviceScaleFactor: 1,
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [],
      external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== new URL(baseUrl).origin
      )
        external.push(request.url());
    });
    stage = `${engine}: welcome and save picker`;
    assert.equal((await page.goto(baseUrl)).status(), 200);
    await checkLayout(page, stage);
    await page.locator('#save-file').setInputFiles({
      name: 'Mobile team with a long save filename for responsive layout checks.sav',
      mimeType: 'application/octet-stream',
      buffer: sample,
    });
    await page.locator('#pokemon-form').waitFor();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const tab of ['pokemon', 'randomizer', 'settings', 'review']) {
        stage = `${engine}: ${tab} at ${width}x${height}`;
        await page.locator(`[data-tab="${tab}"]`).tap();
        await checkLayout(page, stage);
      }
    }

    stage = `${engine}: catalog choosers, edit, undo, redo, and export`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tab="pokemon"]').tap();
    await choose(page, 'species', 'mewtwo', 'Mewtwo');
    await choose(page, 'move', 'pound', 'Pound');
    await choose(page, 'item', 'none', 'None');
    await page.locator('[name="nickname"]').fill('Touch');
    await page.locator('button[type="submit"]').tap();
    await page.locator('#undo-button').tap();
    assert.notEqual(await page.locator('[name="nickname"]').inputValue(), 'Touch');
    await page.locator('#redo-button').tap();
    assert.equal(await page.locator('[name="nickname"]').inputValue(), 'Touch');
    const exportedEvent = page.waitForEvent('download');
    await page.locator('#export-button').tap();
    const exported = await exportedEvent;
    const edited = fs.readFileSync(await exported.path()),
      reopened = new core.Save(edited, catalog);
    assert.equal(edited.length, 131072);
    assert.equal(reopened.party()[0].nickname, 'Touch');
    assert.equal(reopened.party()[0].move1, 1);
    assert.ok(reopened.report().every(section => section.valid));
    const backupEvent = page.waitForEvent('download');
    await page.locator('#backup-button').tap();
    assert.deepEqual(fs.readFileSync(await (await backupEvent).path()), sample);
    await page.screenshot({ path: path.join(output, `${engine}-phone.png`), fullPage: true });

    stage = `${engine}: ability search, pagination, and applying a result`;
    await page.locator('[data-tab="randomizer"]').tap();
    await choose(page, 'ability', '343', catalog.abilities[343].name);
    await page.locator('#target-0').fill('#343');
    await page.locator('#search-button').tap();
    await page.locator('.result-row').first().waitFor({ timeout: 20000 });
    const count = await page.locator('.result-row').count();
    await page.locator('#more-search').tap();
    await page.waitForFunction(
      initial => document.querySelectorAll('.result-row').length > initial,
      count,
    );
    await page.locator('.result-row').first().tap();
    await page.locator('.result-row.is-selected').waitFor();
    assert.equal(await page.locator('#target-0').inputValue(), '#343');

    stage = `${engine}: ability chooser and keyboard-sized viewport`;
    await page.locator('[data-tab="pokemon"]').tap();
    await page.locator('[data-pick-ability]').first().tap();
    await page.locator('#ability-picker').waitFor();
    assert.notEqual(await page.evaluate(() => document.activeElement.id), 'ability-picker-filter');
    await page.setViewportSize({ width: 390, height: 320 });
    await page.locator('#ability-picker-filter').fill('stench');
    await checkDialog(page, '#ability-picker');
    await page.locator('#ability-picker-options .picker-option').first().tap();
    await page.locator('#ability-picker').waitFor({ state: 'detached' });
    const targets = await page
      .locator('input[id^="target-"]')
      .evaluateAll(inputs => inputs.map(input => input.value));
    assert.equal(targets[0], '#343');
    assert.ok(targets.some(value => value.includes('Stench')));
    await page.setViewportSize({ width: 390, height: 844 });

    stage = `${engine}: help dialog and offline download`;
    await page.locator('#help-button').tap();
    await checkDialog(page, '#help-dialog');
    await page.locator('#close-help').tap();
    const offlineEvent = page.waitForEvent('download');
    await page.locator('#offline-button').tap();
    const offline = await offlineEvent,
      offlinePath = path.join(output, `${engine}-offline.html`);
    await offline.saveAs(offlinePath);
    const offlinePage = await context.newPage();
    await offlinePage.goto(pathToFileURL(offlinePath).href);
    await offlinePage.locator('#demo-button').tap();
    await offlinePage.locator('#pokemon-form').waitFor();
    await choose(offlinePage, 'species', 'mewtwo', 'Mewtwo');
    await offlinePage.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      `${engine}: 9 viewport sizes, all editor tabs, touch controls, file import/export, backup, undo/redo, choosers, worker pagination, keyboard-sized dialog, help, and offline editor passed.`,
    );

    if (engine === 'chromium') {
      stage = 'chromium: dialog fallback and invalid-file validation';
      const fallback = await context.newPage();
      await fallback.addInitScript(() => {
        HTMLDialogElement.prototype.showModal = undefined;
        HTMLDialogElement.prototype.close = undefined;
      });
      await fallback.goto(baseUrl);
      await fallback.locator('#help-button').tap();
      await fallback.locator('#help-dialog[open]').waitFor();
      await fallback.locator('#close-help').tap();
      await fallback.locator('#save-file').setInputFiles({
        name: 'wrong.sav',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(16),
      });
      assert.ok((await fallback.locator('#toast').textContent()).includes('128 KB'));
      assert.equal(await fallback.locator('#save-file').inputValue(), '');
      await fallback.locator('#demo-button').tap();
      await fallback.locator('#pokemon-form').waitFor();
      await choose(fallback, 'species', 'mewtwo', 'Mewtwo');
      assert.equal(await fallback.locator('.dialog-backdrop').count(), 0);
      await fallback.close();
      console.log('chromium: missing native dialog APIs and invalid save size handled.');
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const engine of engines) await runEngine(engine);
})().catch(error => {
  console.error(`Failed at ${stage}:`, error);
  process.exitCode = 1;
});
