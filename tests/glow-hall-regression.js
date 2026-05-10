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
const STORAGE_KEY = 'firefly-academy-notebook-glowhall';
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

const CORRECT_CATEGORIES = {
  firefly: 'mate',
  dinoflagellate: 'defense',
  anglerfish: 'lure',
  foxfire: 'spores',
  caveglowworm: 'lure',
  jellyfish: 'defense',
  bobtailsquid: 'defense',
  seafirefly: 'mate',
  flashlightfish: 'lure',
  railroadworm: 'defense',
  vampiresquid: 'defense',
  jackolantern: 'spores'
};

const LAST_TWO_NOTEBOOK = {
  selectedId: 'vampiresquid',
  assignments: Object.fromEntries(
    Object.entries(CORRECT_CATEGORIES).filter(([id]) => id !== 'vampiresquid' && id !== 'jackolantern')
  )
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
      resolve(`http://127.0.0.1:${address.port}/index.html?stage=glowhall`);
    });
  });
}

function zone(page, zoneId) {
  return page.locator(`[data-glow-zone-id="${zoneId}"]`);
}

function organismCard(page, organismId) {
  return page.locator(`[data-glow-organism-id="${organismId}"]`);
}

async function storedGlowHall(page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || '{}'), STORAGE_KEY);
}

async function correctCount(page) {
  const notebook = await storedGlowHall(page);
  return Object.entries(CORRECT_CATEGORIES).filter(([id, category]) => notebook.assignments?.[id] === category).length;
}

async function waitForAssignment(page, organismId, category) {
  await page.waitForFunction(({ key, organismId, category }) => {
    const notebook = JSON.parse(window.localStorage.getItem(key) || '{}');
    return notebook.assignments?.[organismId] === category;
  }, { key: STORAGE_KEY, organismId, category }, { timeout: 60000 });
}

async function waitForSelected(page, organismId) {
  await page.waitForFunction(({ key, organismId }) => {
    const notebook = JSON.parse(window.localStorage.getItem(key) || '{}');
    return notebook.selectedId === organismId;
  }, { key: STORAGE_KEY, organismId }, { timeout: 60000 });
}

async function assertCardIncludes(page, organismId, expected) {
  const text = await organismCard(page, organismId).innerText();
  assert.ok(
    text.toLowerCase().includes(expected.toLowerCase()),
    `${organismId} card should include "${expected}". Actual text:\n${text}`
  );
}

async function assertActiveHeading(page, expected) {
  await page.waitForFunction((expected) => {
    return [...document.querySelectorAll('h3')]
      .some(heading => heading.textContent?.trim() === expected);
  }, expected, { timeout: 60000 });
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
  const page = await browser.newPage({
    viewport: { width: 768, height: 1024 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) browserErrors.push(text);
  });

  try {
    await page.addInitScript(({ storageKey, notebook }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      const serialized = JSON.stringify(notebook);
      window.localStorage.setItem(storageKey, serialized);
      window.sessionStorage.setItem(storageKey, serialized);
      window.localStorage.setItem('firefly-academy-current-stage', '3');
    }, { storageKey: STORAGE_KEY, notebook: LAST_TWO_NOTEBOOK });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByRole('heading', { name: 'Glow Hall of Fame' }).waitFor({ timeout: 60000 });
    await waitForSelected(page, 'vampiresquid');
    await assertActiveHeading(page, 'Vampire Squid');
    assert.equal(await correctCount(page), 10, 'preloaded hall should leave exactly two organisms unfinished');

    await zone(page, 'lure').tap();
    await waitForAssignment(page, 'vampiresquid', 'lure');
    await waitForSelected(page, 'vampiresquid');
    await assertActiveHeading(page, 'Vampire Squid');
    await assertCardIncludes(page, 'vampiresquid', 'Lure Prey');
    assert.equal(await correctCount(page), 10, 'wrong Vampire Squid answer should not add a correct case');

    await zone(page, 'defense').tap();
    await waitForAssignment(page, 'vampiresquid', 'defense');
    await waitForSelected(page, 'jackolantern');
    await assertActiveHeading(page, 'Jack-o-Lantern Mushroom');
    await assertCardIncludes(page, 'vampiresquid', 'Warn or Startle');
    assert.equal(await correctCount(page), 11, 'correct Vampire Squid answer should be accepted');

    await zone(page, 'mate').tap();
    await waitForAssignment(page, 'jackolantern', 'mate');
    await waitForSelected(page, 'jackolantern');
    await assertActiveHeading(page, 'Jack-o-Lantern Mushroom');
    await assertCardIncludes(page, 'jackolantern', 'Find a Mate');
    assert.equal(await correctCount(page), 11, 'wrong Jack-o-Lantern answer should not add a correct case');

    await zone(page, 'spores').tap();
    await waitForAssignment(page, 'jackolantern', 'spores');
    await waitForSelected(page, 'jackolantern');
    await assertCardIncludes(page, 'jackolantern', 'Spread Spores');
    assert.equal(await correctCount(page), 12, 'correct Jack-o-Lantern answer should be accepted');
    assert.ok(
      await page.getByRole('button', { name: /Meet Species/ }).isEnabled(),
      'Meet Species should unlock after every Glow Hall case is correct'
    );

    assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
    console.log('Glow Hall regression passed');
  } finally {
    await page.close();
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
