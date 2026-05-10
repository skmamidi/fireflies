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

function isIgnorableConsoleError(text) {
  return text.includes('[BABEL] Note: The code generator has deoptimised');
}

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

async function openStage(page, index) {
  await page.locator(`[data-stage-index="${index}"]`).click();
  await page.waitForTimeout(250);
}

async function setRange(page, label, value) {
  await page.getByLabel(label).evaluate((input, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function assertCompassIncludes(page, expected) {
  const text = await page.locator('section[aria-label="Field journal mission compass"]').innerText();
  assert.ok(
    text.toLowerCase().includes(expected.toLowerCase()),
    `Quest compass should include "${expected}". Actual text:\n${text}`
  );
}

async function assertActivityAboveFold(page, minVisiblePx, label) {
  const metrics = await page.evaluate(() => {
    const stage = document.querySelector('main > div.flex-1')?.getBoundingClientRect();
    return {
      stageTop: Math.round(stage?.top || 0),
      visible: Math.round(window.innerHeight - (stage?.top || 0)),
      viewportHeight: window.innerHeight
    };
  });

  assert.ok(
    metrics.visible >= minVisiblePx,
    `${label} activity should appear in the first viewport. Expected at least ${minVisiblePx}px visible, got ${metrics.visible}px. Metrics: ${JSON.stringify(metrics)}`
  );
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 940 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) browserErrors.push(text);
  });

  try {
    await loadClean(page, url);
    await openStage(page, 9);

    await page.getByRole('heading', { name: 'Dark-Sky Signal Lab' }).waitFor({ timeout: 60000 });
    await assertActivityAboveFold(page, 320, 'Light Pollution desktop');
    await assertCompassIncludes(page, 'Mission 10/14');
    await assertCompassIncludes(page, 'Raise the light stressors');
    await assertCompassIncludes(page, '0% light stress');
    await page.getByText('Healthy dark sky - Bortle 2-3 meadow').waitFor();
    await page.getByText('Signal clarity').waitFor();
    await page.getByText('15/15').waitFor();

    const blockedButton = page.getByRole('button', { name: /Trigger critical light/ });
    assert.equal(await blockedButton.isDisabled(), true, 'continue should stay locked before the full learning loop');

    await setRange(page, 'Urban skyglow intensity', 100);
    await setRange(page, 'Car headlight intensity', 100);
    await setRange(page, 'White LED intensity', 100);
    await page.getByText('Critical flash blackout - Urban washout').waitFor();
    await page.getByText('0/15').waitFor();
    await assertCompassIncludes(page, '100% effective light stress');
    await assertCompassIncludes(page, 'Build a dark-sky rescue plan');

    await page.getByRole('button', { name: /Switch Off Extras/ }).click();
    await page.getByRole('button', { name: /Shield Downward/ }).click();
    await page.getByText('Rescue plan ready').waitFor();
    assert.equal(await blockedButton.isDisabled(), true, 'continue should stay locked until the sky is actually restored');

    await setRange(page, 'Urban skyglow intensity', 0);
    await setRange(page, 'Car headlight intensity', 0);
    await setRange(page, 'White LED intensity', 0);
    await page.getByText('Dark sky restored', { exact: true }).first().waitFor();
    await page.getByText('Healthy dark sky - Bortle 2-3 meadow').waitFor();
    await page.getByText('15/15').waitFor();
    await assertCompassIncludes(page, 'Dark sky restored');

    const continueButton = page.getByRole('button', { name: /Continue to Ecosystem/ });
    assert.equal(await continueButton.isEnabled(), true, 'continue should unlock after crisis, plan, and restoration');
    await continueButton.click();
    await page.waitForTimeout(300);

    assert.equal(
      await page.locator('header button[aria-label^="Dark Sky Defender:"]').getAttribute('aria-label'),
      'Dark Sky Defender: earned'
    );
    assert.equal(await page.evaluate(() => window.localStorage.getItem('firefly-academy-current-stage')), '10');
    await assertCompassIncludes(page, 'Mission 11/14');
    await assertCompassIncludes(page, 'Ecosystem Role');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', (error) => browserErrors.push(error.message));
    mobile.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !isIgnorableConsoleError(text)) browserErrors.push(text);
    });
    await loadClean(mobile, url);
    await openStage(mobile, 9);
    await mobile.getByRole('heading', { name: 'Dark-Sky Signal Lab' }).waitFor({ timeout: 60000 });
    await assertActivityAboveFold(mobile, 120, 'Light Pollution mobile');
    await mobile.getByLabel('Urban skyglow intensity').waitFor();
    await mobile.getByRole('button', { name: /Switch Off Extras/ }).waitFor();
    await mobile.close();

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Light pollution regression passed');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
