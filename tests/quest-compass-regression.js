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

async function storedCurrentStage(page) {
  return page.evaluate(() => window.localStorage.getItem('firefly-academy-current-stage'));
}

async function openStage(page, index) {
  await page.locator(`[data-stage-index="${index}"]`).click();
  await page.waitForTimeout(250);
}

async function run() {
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
    assert.equal(await storedCurrentStage(page), '0');

    await openStage(page, 5);
    await assertCompassIncludes(page, 'Mission 6/14');
    await assertCompassIncludes(page, 'Global Map');
    await assertCompassIncludes(page, 'Collect field stamps across United States and worldwide habitats.');
    await assertCompassIncludes(page, 'Resume Start Journey');
    assert.equal(await storedCurrentStage(page), '5');

    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
    await assertCompassIncludes(page, 'Mission 6/14');
    await assertCompassIncludes(page, 'Global Map');
    assert.equal(await storedCurrentStage(page), '5');

    await page.getByRole('button', { name: /Resume Start Journey/ }).click();
    await page.waitForTimeout(250);
    await assertCompassIncludes(page, 'Mission 1/14');
    await assertCompassIncludes(page, 'Keep Working Here');
    assert.equal(await storedCurrentStage(page), '0');

    await page.getByRole('button', { name: 'Begin Global Research' }).click();
    await page.waitForTimeout(350);
    await assertCompassIncludes(page, 'Mission 2/14');
    await assertCompassIncludes(page, 'Family Tree');
    await assertCompassIncludes(page, 'Build the science family tree from kingdom to firefly branch.');
    assert.equal(await storedCurrentStage(page), '1');
    assert.equal(
      await page.locator('header button[aria-label^="First Flash:"]').getAttribute('aria-label'),
      'First Flash: earned'
    );

    await page.getByRole('button', { name: 'View Badge' }).click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('header h2').last().innerText(), 'Lampyridae Lineage');

    await page.evaluate(() => window.localStorage.setItem('firefly-academy-current-stage', '99'));
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
    await assertCompassIncludes(page, 'Mission 14/14');
    await assertCompassIncludes(page, 'Ranger Test');
    assert.equal(await storedCurrentStage(page), '13');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (error) => browserErrors.push(error.message));
    mobile.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await loadClean(mobile, url);
    await assertCompassIncludes(mobile, 'Field Journal');
    await assertCompassIncludes(mobile, 'Mission 1/14');
    await mobile.getByRole('button', { name: 'Global Map' }).tap();
    await mobile.waitForTimeout(250);
    await assertCompassIncludes(mobile, 'Mission 6/14');
    assert.equal(await storedCurrentStage(mobile), '5');
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
