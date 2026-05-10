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

async function openStage(page, index) {
  await page.locator(`[data-stage-index="${index}"]`).click();
  await page.waitForTimeout(150);
}

async function badgeLabel(page, name) {
  return page.locator(`header button[aria-label^="${name}:"]`).getAttribute('aria-label');
}

async function expectBadge(page, name, state) {
  assert.equal(await badgeLabel(page, name), `${name}: ${state}`);
}

async function storedArray(page, key) {
  return page.evaluate((storageKey) => {
    const value = window.sessionStorage.getItem(storageKey);
    return value ? JSON.parse(value) : [];
  }, key);
}

async function earnedBadges(page) {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('firefly-academy-earned-badges') || '[]'));
}

async function clickFirstButtonContaining(page, text) {
  await page.locator('button').filter({ hasText: text }).first().click();
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

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) browserErrors.push(text);
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('h1').waitFor({ timeout: 60000 }).catch(async (error) => {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      throw new Error([
        'App shell did not render before badge assertions.',
        `Original wait error: ${error.message}`,
        `Browser errors: ${browserErrors.join(' | ') || 'none'}`,
        `Body text: ${bodyText.slice(0, 500) || '(empty)'}`
      ].join('\n'));
    });

    const badgeButtons = await page.locator('header button[aria-label]').count();
    assert.equal(badgeButtons, 14, 'header should expose one clickable badge per section');

    const badgeNames = [
      'First Flash',
      'Lampyridae Lineage',
      'Cold Light Chemist',
      'Glow Curator',
      'Species Scout',
      'Field Atlas',
      'Larva Guardian',
      'Evolution Engineer',
      'Canopy Researcher',
      'Dark Sky Defender',
      'Food Web Steward',
      'Sanctuary Designer',
      'Trivia Spark',
      'Master Ranger'
    ];

    for (const name of badgeNames) {
      await page.locator(`header button[aria-label^="${name}:"]`).click();
      assert.equal(await page.locator('header h2').last().innerText(), name);
      const helpText = await page.locator('header p').first().innerText();
      assert.ok(helpText.length > 12, `${name} should explain how to earn it`);
    }

    await openStage(page, 4);
    for (const speciesName of [
      'Snappy Single Sync',
      'Smoky Mountain Sync',
      'Big Dipper Firefly',
      'Blue Ghost',
      'Winter Firefly',
      'Spring Tree-Top Flasher',
      'Genji-botaru',
      'Mangrove Sync',
      'Giant Glowworm',
      'Southwest Sync',
      'Femme Fatale'
    ]) {
      await clickFirstButtonContaining(page, speciesName);
    }
    await page.waitForFunction(() => {
      const studied = JSON.parse(window.sessionStorage.getItem('firefly-academy-session-species-studied') || '[]');
      return studied.length === 11;
    });
    await expectBadge(page, 'Species Scout', 'earned');
    assert.equal((await storedArray(page, 'firefly-academy-session-species-studied')).length, 11);

    await openStage(page, 5);
    await page.waitForFunction(() => {
      const stamps = JSON.parse(window.sessionStorage.getItem('firefly-academy-session-map-stamps') || '[]');
      return stamps.includes('congaree');
    });

    for (const locationName of [
      'Congaree National Park',
      'Great Smoky Mountains',
      'Allegheny National Forest',
      'Grandfather Mountain',
      'High Bridge Trail',
      'Santa Rita Mountains'
    ]) {
      await page.getByRole('button', { name: `Open ${locationName}` }).click();
    }

    await page.getByRole('button', { name: 'Worldwide' }).click();
    await page.waitForFunction(() => {
      const stamps = JSON.parse(window.sessionStorage.getItem('firefly-academy-session-map-stamps') || '[]');
      return stamps.includes('mexico');
    });

    for (const locationName of [
      'Nanacamilpa Sanctuary',
      'Uji River / Kyoto',
      'Kampung Kuantan',
      'Apennine Mountains',
      'Emas National Park'
    ]) {
      await page.getByRole('button', { name: `Open ${locationName}` }).click();
    }
    await page.waitForFunction(() => {
      const stamps = JSON.parse(window.sessionStorage.getItem('firefly-academy-session-map-stamps') || '[]');
      return stamps.length === 11;
    });
    await expectBadge(page, 'Field Atlas', 'earned');
    assert.equal((await storedArray(page, 'firefly-academy-session-map-stamps')).length, 11);

    await openStage(page, 10);
    await page.getByRole('button', { name: /Health Signal/ }).click();
    await page.getByRole('button', { name: /Glow Rescue/ }).click();
    await expectBadge(page, 'Food Web Steward', 'earned');
    assert.deepEqual(
      (await storedArray(page, 'firefly-academy-session-ecosystem-tabs')).sort(),
      ['action', 'importance', 'indicator']
    );

    await page.reload({ waitUntil: 'networkidle' });
    await expectBadge(page, 'Species Scout', 'earned');
    await expectBadge(page, 'Field Atlas', 'earned');
    await expectBadge(page, 'Food Web Steward', 'earned');

    const earned = await earnedBadges(page);
    for (const badgeId of ['species', 'map', 'ecosystem']) {
      assert.ok(earned.includes(badgeId), `${badgeId} badge should persist in localStorage`);
    }

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Badge wiring regression passed');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
