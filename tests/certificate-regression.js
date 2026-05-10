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
      resolve(`http://127.0.0.1:${address.port}/index.html?stage=conservation`);
    });
  });
}

async function answerCorrectly(page, answer, continueLabel = /Next Mission|See Results/) {
  await page.getByRole('button', { name: answer }).click();
  await page.getByRole('button', { name: continueLabel }).click();
}

async function seedBadgePassport(page, badgeIds) {
  await page.evaluate((ids) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem('firefly-academy-earned-badges', JSON.stringify(ids));
  }, badgeIds);
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
}

async function passRangerTest(page) {
  await page.getByRole('button', { name: /Start Ranger Test/ }).click();

  await answerCorrectly(page, /Turn the extra light off/);
  await answerCorrectly(page, /Leave some leaves and logs/);
  await answerCorrectly(page, /Dump standing water/);
  await answerCorrectly(page, /Watch them for a short time/);
  await answerCorrectly(page, /Notes about date, place, weather/);
}

async function installCertificateMocks(page) {
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.__sharedText = '';
    window.print = () => {
      window.__printCalls += 1;
    };
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => {
        window.__sharedText = data.text;
      }
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__sharedText = text;
        }
      }
    });
  });
}

async function run() {
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(source.includes('@media print'), 'certificate should include a print stylesheet');
  assert.ok(source.includes('printable-ranger-award'), 'certificate should mark the printable award area');
  assert.ok(source.includes('showDebrief: false'), 'final pledge should not hide the certificate behind the field-report modal');
  assert.ok(source.includes('PLEDGE_BADGE_REQUIREMENT = 7'), 'pledge should require seven earned badges');

  const server = createServer();
  const url = await listen(server);
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) browserErrors.push(text);
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const sixBadgePassport = ['intro', 'familytree', 'science', 'glowhall', 'species', 'map'];
    const sevenBadgePassport = [...sixBadgePassport, 'tamagotchi'];

    await seedBadgePassport(page, sixBadgePassport);
    await passRangerTest(page);
    await page.getByRole('button', { name: /Take Ranger Pledge/ }).click();
    await page.getByText(/Badge checkpoint: earn 1 more badge before the Junior Ranger pledge/).waitFor({ timeout: 60000 });
    assert.equal(await page.getByLabel('Ranger name').count(), 0, 'pledge form should stay locked until seven badges are earned');

    await seedBadgePassport(page, sevenBadgePassport);
    await installCertificateMocks(page);
    await passRangerTest(page);

    await page.getByRole('button', { name: /Take Ranger Pledge/ }).click();
    for (const line of [
      /keeping summer nights darker/,
      /leaves, soil, logs/,
      /watch fireflies gently/,
      /avoid sprays/,
      /share what I learn/
    ]) {
      await page.getByRole('button', { name: line }).click();
    }
    await page.getByLabel('Ranger name').fill('Avery');
    await page.getByRole('button', { name: /I Pledge to Protect Fireflies/ }).click();

    const certificate = page.locator('section[aria-label="Printable Master Ranger certificate"]');
    await certificate.waitFor({ timeout: 60000 });
    await certificate.getByText('Master Ranger Certificate').waitFor({ timeout: 60000 });
    await certificate.getByText('Avery').waitFor({ timeout: 60000 });
    await certificate.getByText('Ranger Score').waitFor({ timeout: 60000 });
    await certificate.getByText('5/5').first().waitFor({ timeout: 60000 });
    await certificate.getByText('Passport Summary').waitFor({ timeout: 60000 });

    assert.equal(await page.getByRole('dialog', { name: /field report/i }).count(), 0, 'final certificate should not be covered by a field-report dialog');
    assert.ok(
      (await page.evaluate(() => JSON.parse(window.localStorage.getItem('firefly-academy-earned-badges') || '[]'))).includes('conservation'),
      'Master Ranger badge should persist after the pledge'
    );

    await page.getByRole('button', { name: /Print \/ Save PDF/ }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1, 'print button should call window.print');

    await page.getByRole('button', { name: /Share Certificate/ }).click();
    await page.waitForFunction(() => window.__sharedText.includes('Avery'), null, { timeout: 60000 });
    await page.getByText(/Certificate ready to share|Certificate summary copied/).waitFor({ timeout: 60000 });

    await page.getByRole('button', { name: /Open Passport/ }).click();
    await page.getByRole('dialog', { name: /Field notebook passport/ }).waitFor({ timeout: 60000 });
    await page.locator('[data-passport-stage-id="conservation"]').getByText('Earned').waitFor({ timeout: 60000 });

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Certificate regression passed');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
