#!/usr/bin/env node

/**
 * Scrappy Wiki Sync Daemon
 *
 * Runs a headless browser to keep a wiki online 24/7.
 * This ensures data persists even when no users are connected.
 *
 * Usage:
 *   node sync-daemon.js <token> [wiki-url]
 *
 * Examples:
 *   node sync-daemon.js abc123
 *   node sync-daemon.js abc123 http://localhost:8080
 */

import puppeteer from 'puppeteer';

const token = process.argv[2];
const baseUrl = process.argv[3] || 'https://wiki.drifting.ink';

if (!token) {
  console.error('Usage: node sync-daemon.js <token> [wiki-url]');
  console.error('Example: node sync-daemon.js abc123');
  process.exit(1);
}

const WIKI_URL = `${baseUrl}/?token=${token}`;
const RECONNECT_DELAY = 5000;

let browser = null;
let page = null;

async function start() {
  console.log(`Starting sync daemon for token: ${token}`);
  console.log(`URL: ${WIKI_URL}`);

  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  page = await browser.newPage();

  // Log console messages from the wiki
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Peer') || text.includes('Sync') || text.includes('connect')) {
      console.log(`[wiki] ${text}`);
    }
  });

  // Handle page crashes
  page.on('error', async (err) => {
    console.error('Page crashed:', err.message);
    await reconnect();
  });

  // Handle disconnections
  page.on('close', async () => {
    console.log('Page closed, reconnecting...');
    await reconnect();
  });

  await connect();
}

async function connect() {
  try {
    console.log('Connecting to wiki...');
    await page.goto(WIKI_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Connected! Sync daemon is running.');
    console.log('Press Ctrl+C to stop.\n');
  } catch (err) {
    console.error('Failed to connect:', err.message);
    await reconnect();
  }
}

async function reconnect() {
  console.log(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
  await new Promise(r => setTimeout(r, RECONNECT_DELAY));

  try {
    if (page && !page.isClosed()) {
      await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
      console.log('Reconnected!');
    } else {
      page = await browser.newPage();
      await connect();
    }
  } catch (err) {
    console.error('Reconnect failed:', err.message);
    await reconnect();
  }
}

async function shutdown() {
  console.log('\nShutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
