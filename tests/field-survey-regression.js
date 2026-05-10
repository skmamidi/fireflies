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
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function addDeterministicSurvey(page) {
  await page.addInitScript(() => {
    window.__FIREFLY_SURVEY_TEST__ = {
      siteId: 'cove-edge',
      targetType: 'smoky',
      bugs: [
        { id: 'smoky-0', type: 'smoky', x: 38, y: 30, delay: '0s' },
        { id: 'smoky-1', type: 'smoky', x: 58, y: 48, delay: '0s' },
        { id: 'snappy-0', type: 'snappy', x: 34, y: 72, delay: '0.5s' },
        { id: 'ghost-0', type: 'ghost', x: 72, y: 42, delay: '1.1s' }
      ]
    };
  });
}

async function assertBodyIncludes(page, expected) {
  const text = await page.locator('body').innerText();
  assert.ok(
    text.toLowerCase().includes(expected.toLowerCase()),
    `Page should include "${expected}". Actual text:\n${text.slice(0, 1800)}`
  );
}

async function run() {
  const server = createServer();
  const baseUrl = await listen(server);
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
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  try {
    await addDeterministicSurvey(page);
    await page.goto(new URL('field-survey.html', baseUrl).toString(), { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('section[aria-label="Field journal mission compass"]').waitFor({ timeout: 60000 });
    await page.getByRole('heading', { name: 'Field Survey Lab' }).waitFor({ timeout: 60000 });

    await assertBodyIncludes(page, 'Signal Field Guide');
    await assertBodyIncludes(page, 'Practice the patterns before the count');
    await assertBodyIncludes(page, 'Cove Forest Transect');
    await assertBodyIncludes(page, 'Study the signal field guide');

    await page.getByRole('button', { name: /Start Field Survey/ }).click();
    await page.getByText('Active Transect').waitFor();
    await assertBodyIncludes(page, 'Target Pattern');
    await assertBodyIncludes(page, 'Data Quality');
    await assertBodyIncludes(page, 'Observer Protocol');
    await assertBodyIncludes(page, '0/2 targets, 0 false positives');
    assert.equal(await page.locator('[data-survey-bug-type="smoky"]').count(), 2);
    assert.equal(await page.locator('[data-survey-bug-type="snappy"]').count(), 1);
    assert.equal(await page.locator('[data-survey-bug-type="ghost"]').count(), 1);

    await page.locator('[data-survey-bug-type="smoky"]').first().click();
    await page.locator('[data-survey-bug-type="snappy"]').first().click();
    await assertBodyIncludes(page, 'Review false positives');
    await assertBodyIncludes(page, '1/2 targets, 1 false positives');
    await assertBodyIncludes(page, 'Do not confuse it with synchronized bursts');

    await page.getByRole('button', { name: 'Submit Data' }).click();
    await page.getByRole('heading', { name: 'Data Error!' }).waitFor();
    await assertBodyIncludes(page, 'Precision');
    await assertBodyIncludes(page, 'Recall');
    await assertBodyIncludes(page, 'False Positives');
    await assertBodyIncludes(page, '50%');
    await assertBodyIncludes(page, 'Use the report below like a real observer would');

    await page.getByRole('button', { name: /Retry Survey/ }).click();
    await page.getByText('Active Transect').waitFor();
    await page.locator('[data-survey-bug-type="smoky"]').first().click();
    await page.locator('[data-survey-bug-type="smoky"]').nth(1).click();
    await assertBodyIncludes(page, 'Ready to submit');
    await assertBodyIncludes(page, '2/2 targets, 0 false positives');

    await page.getByRole('button', { name: 'Submit Data' }).click();
    await page.getByRole('heading', { name: 'Perfect Observation!' }).waitFor();
    await assertBodyIncludes(page, '100%');
    await assertBodyIncludes(page, 'clean count researchers can compare over time');

    await page.getByRole('button', { name: /Continue/ }).click();
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator('header button[aria-label^="Canopy Researcher:"]').getAttribute('aria-label'),
      'Canopy Researcher: earned'
    );
    assert.equal(await page.evaluate(() => window.localStorage.getItem('firefly-academy-current-stage')), '9');
    await assertBodyIncludes(page, 'Light Pollution');

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Field survey regression passed');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
