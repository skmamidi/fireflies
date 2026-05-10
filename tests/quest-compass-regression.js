#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  try {
    const codexPlaywright = path.join(
      os.homedir(),
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
    );
    ({ chromium } = require(codexPlaywright));
  } catch {
    console.error('Missing Playwright. Run with a Node environment where the playwright package is available.');
    console.error('In Codex, set NODE_PATH to the bundled node_modules path before running this script.');
    process.exit(1);
  }
}

const ROOT = path.resolve(__dirname, '..');
const STAGE_ENTRY_FILES = [
  ['start-journey.html', 'stage=intro'],
  ['family-tree.html', 'stage=familytree'],
  ['bioluminescence.html', 'stage=science'],
  ['glow-hall.html', 'stage=glowhall'],
  ['meet-the-bugs.html', 'stage=species'],
  ['global-map.html', 'stage=map'],
  ['raise-a-firefly.html', 'stage=tamagotchi'],
  ['build-a-bug.html', 'stage=buildabug'],
  ['field-survey.html', 'stage=researcher'],
  ['light-pollution.html', 'stage=pollution'],
  ['ecosystem-role.html', 'stage=ecosystem'],
  ['sanctuary-yard.html', 'stage=sanctuary'],
  ['trivia-arcade.html', 'stage=trivia'],
  ['ranger-test.html', 'stage=conservation']
];
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function createServer() {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const cleanPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const filePath = path.normalize(path.join(ROOT, cleanPath));

    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, bytes) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'
      });
      response.end(bytes);
    });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/index.html`);
    });
  });
}

async function loadClean(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
}

async function compassText(page) {
  return page.locator('section[aria-label="Field journal mission compass"]').innerText();
}

async function assertCompassIncludes(page, expected) {
  const text = await compassText(page);
  assert.ok(
    text.toLowerCase().includes(expected.toLowerCase()),
    `Quest compass should include "${expected}". Actual text:\n${text}`
  );
}

async function assertShellBadge(page, expectedTitle, expectedStatus = 'Current Mission') {
  await page.waitForFunction((title) => {
    const badgeTitle = document.querySelector('.badge-summary-panel h2')?.textContent?.trim();
    return badgeTitle === title;
  }, expectedTitle, { timeout: 60000 });

  const text = await page.locator('.badge-summary-panel').innerText();
  assert.ok(
    text.toLowerCase().includes(expectedStatus.toLowerCase()),
    `Badge shell should include "${expectedStatus}". Actual text:\n${text}`
  );
}

async function storedCurrentStage(page) {
  return page.evaluate(() => window.localStorage.getItem('firefly-academy-current-stage'));
}

async function openStage(page, index) {
  await page.locator(`[data-stage-index="${index}"]`).click();
  await page.waitForTimeout(250);
}

async function run() {
  for (const [file, target] of STAGE_ENTRY_FILES) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(html.includes(`./index.html?${target}`), `${file} should redirect to ${target}`);
  }

  const server = createServer();
  const url = await listen(server);
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined
  });

  const browserErrors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  try {
    await loadClean(page, url);

    await assertCompassIncludes(page, 'Field Journal');
    await assertCompassIncludes(page, 'Mission 1/14');
    await assertCompassIncludes(page, 'Start Journey');
    await assertCompassIncludes(page, 'Start the expedition and set your first field note.');
    await assertCompassIncludes(page, 'Ready to launch');
    await assertShellBadge(page, 'First Flash');
    assert.equal(await page.title(), 'Start Journey | Global Firefly Academy');
    assert.equal(await page.locator('[data-stage-index="5"]').getAttribute('href'), './global-map.html');
    assert.equal(await storedCurrentStage(page), '0');

    await openStage(page, 5);
    await assertCompassIncludes(page, 'Mission 6/14');
    await assertCompassIncludes(page, 'Global Map');
    await assertCompassIncludes(page, 'Collect field stamps across United States and worldwide habitats.');
    await assertCompassIncludes(page, '1/11 atlas stamps');
    await assertCompassIncludes(page, 'Resume Start Journey');
    await assertShellBadge(page, 'Field Atlas');
    assert.equal(await page.title(), 'Global Map | Global Firefly Academy');
    assert.equal(await storedCurrentStage(page), '5');
    assert.ok(page.url().endsWith('/global-map.html'), `stage navigation should expose the stage HTML URL. Actual URL: ${page.url()}`);

    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
    await assertCompassIncludes(page, 'Mission 6/14');
    await assertCompassIncludes(page, 'Global Map');
    await assertCompassIncludes(page, '1/11 atlas stamps');
    await assertShellBadge(page, 'Field Atlas');
    assert.equal(await page.title(), 'Global Map | Global Firefly Academy');
    assert.equal(await storedCurrentStage(page), '5');

    await page.getByRole('button', { name: /Resume Start Journey/ }).click();
    await page.waitForTimeout(250);
    await assertCompassIncludes(page, 'Mission 1/14');
    await assertCompassIncludes(page, 'Keep Working Here');
    await assertShellBadge(page, 'First Flash');
    assert.equal(await storedCurrentStage(page), '0');

    await page.getByRole('button', { name: 'Begin Global Research' }).click();
    await page.waitForTimeout(350);
    await assertCompassIncludes(page, 'Mission 2/14');
    await assertCompassIncludes(page, 'Family Tree');
    await assertCompassIncludes(page, 'Build the science family tree from kingdom to firefly branch.');
    await assertCompassIncludes(page, '0/6 branches matched');
    assert.equal(await storedCurrentStage(page), '1');
    await assertShellBadge(page, 'Lampyridae Lineage');
    assert.equal(await page.title(), 'Family Tree | Global Firefly Academy');
    assert.equal(
      await page.locator('header button[aria-label^="First Flash:"]').getAttribute('aria-label'),
      'First Flash: earned'
    );

    await page.getByRole('button', { name: 'View Badge' }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('header h2').last().innerText(), 'Lampyridae Lineage');

    await page.evaluate(() => window.localStorage.setItem('firefly-academy-current-stage', '99'));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
    await assertCompassIncludes(page, 'Mission 14/14');
    await assertCompassIncludes(page, 'Ranger Test');
    assert.equal(await storedCurrentStage(page), '13');

    await openStage(page, 4);
    await assertCompassIncludes(page, 'Mission 5/14');
    await assertCompassIncludes(page, '0/11 species studied');
    await page.getByRole('button', { name: /Snappy Single Sync/ }).first().click();
    await page.waitForTimeout(150);
    await assertCompassIncludes(page, '1/11 species studied');
    await page.getByRole('button', { name: /Smoky Mountain Sync/ }).first().click();
    await page.waitForTimeout(150);
    await assertCompassIncludes(page, '2/11 species studied');

    await openStage(page, 5);
    await assertCompassIncludes(page, '1/11 atlas stamps');
    await page.getByRole('button', { name: 'Worldwide' }).click();
    await page.waitForTimeout(250);
    await assertCompassIncludes(page, '2/11 atlas stamps');

    await openStage(page, 10);
    await assertCompassIncludes(page, '1/3 ecosystem labs explored');
    await page.getByRole('button', { name: /Health Signal/ }).click();
    await page.waitForTimeout(150);
    await assertCompassIncludes(page, '2/3 ecosystem labs explored');
    await page.getByRole('button', { name: /Glow Rescue/ }).click();
    await page.waitForTimeout(150);
    await assertCompassIncludes(page, '3/3 ecosystem labs explored');

    const stageEntry = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    stageEntry.on('pageerror', (error) => browserErrors.push(error.message));
    stageEntry.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await loadClean(stageEntry, new URL('global-map.html', url).toString());
    await assertCompassIncludes(stageEntry, 'Mission 6/14');
    await assertCompassIncludes(stageEntry, 'Global Map');
    await assertCompassIncludes(stageEntry, '1/11 atlas stamps');
    assert.ok(stageEntry.url().endsWith('/global-map.html'), `direct stage entry should settle on the stage HTML URL. Actual URL: ${stageEntry.url()}`);
    await assertShellBadge(stageEntry, 'Field Atlas');
    assert.equal(await stageEntry.title(), 'Global Map | Global Firefly Academy');
    await stageEntry.close();

    const surveyEntry = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    surveyEntry.on('pageerror', (error) => browserErrors.push(error.message));
    surveyEntry.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await loadClean(surveyEntry, new URL('field-survey.html', url).toString());
    await assertCompassIncludes(surveyEntry, 'Mission 9/14');
    await assertCompassIncludes(surveyEntry, 'Field Survey');
    await surveyEntry.getByRole('heading', { name: 'Field Survey Lab' }).waitFor({ timeout: 60000 });
    assert.ok(surveyEntry.url().endsWith('/field-survey.html'), `field survey should settle on its stage HTML URL. Actual URL: ${surveyEntry.url()}`);
    await assertShellBadge(surveyEntry, 'Canopy Researcher');
    assert.equal(await surveyEntry.title(), 'Field Survey | Global Firefly Academy');
    await surveyEntry.close();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (error) => browserErrors.push(error.message));
    mobile.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await loadClean(mobile, url);
    await assertCompassIncludes(mobile, 'Field Journal');
    await assertCompassIncludes(mobile, 'Mission 1/14');
    await mobile.locator('[data-stage-index="5"]').tap();
    await mobile.waitForTimeout(250);
    await assertCompassIncludes(mobile, 'Mission 6/14');
    await assertCompassIncludes(mobile, '1/11 atlas stamps');
    assert.equal(await storedCurrentStage(mobile), '5');
    await assertShellBadge(mobile, 'Field Atlas');
    await mobile.evaluate(() => window.scrollTo(0, 420));
    await mobile.waitForFunction(() => {
      const element = document.querySelector('.badge-summary-panel');
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return Number.parseFloat(style.opacity) < 0.1 && style.maxHeight === '0px';
    }, null, { timeout: 60000 });
    await mobile.close();

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Quest compass regression passed');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
