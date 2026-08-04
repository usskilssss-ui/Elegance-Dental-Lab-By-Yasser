/**
 * Elegance Dental Lab — Station Scan Agent
 * Runs on a lab Windows PC next to a USB barcode scanner (keyboard wedge).
 * Logs in as scanner1 / scanner2 / scanner3 and POSTs scanned codes to /api/cases/scan.
 *
 * Usage:
 *   node agent.js config.scanner2.json
 *   npm run start:2
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const readline = require('readline');

const configPath = path.resolve(
  process.cwd(),
  process.argv[2] || process.env.SCAN_CONFIG || 'config.json'
);

if (!fs.existsSync(configPath)) {
  console.error(`❌ Config not found: ${configPath}`);
  console.error('   Copy config.scannerN.example.json → config.scannerN.json and fill EMAIL/PASSWORD');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const SERVER_URL = String(config.SERVER_URL || '').replace(/\/$/, '');
const EMAIL = String(config.EMAIL || '').trim().toLowerCase();
const PASSWORD = String(config.PASSWORD || '');
const LABEL = String(config.LABEL || 'Scan Agent');
const TOKEN_REFRESH_MS = Number(config.TOKEN_REFRESH_MS) || 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = Number(config.REQUEST_TIMEOUT_MS) || 60000;
const LOGIN_RETRIES = Number(config.LOGIN_RETRIES) || 8;

if (!SERVER_URL || !EMAIL || !PASSWORD) {
  console.error('❌ Config needs SERVER_URL, EMAIL, PASSWORD');
  process.exit(1);
}

let authToken = '';
let authRole = '';
let busy = false;
let buffer = '';
let lastKeyAt = 0;
const KEY_GAP_MS = 120; // barcode wedges are faster than human typing
const MIN_CODE_LEN = 6;

console.log('📷 Elegance Scan Agent starting...');
console.log(`   Config : ${configPath}`);
console.log(`   Label  : ${LABEL}`);
console.log(`   Server : ${SERVER_URL}`);
console.log(`   Email  : ${EMAIL}`);

function beep(ok) {
  if (process.platform !== 'win32') return;
  const freq = ok ? 880 : 220;
  const dur = ok ? 120 : 280;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-Command', `[console]::beep(${freq},${dur})`],
    { windowsHide: true },
    () => {}
  );
}

function httpJson(method, urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        family: 4, // prefer IPv4 — avoids some Windows IPv6 hang/timeouts
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = { raw };
          }
          resolve({ status: res.statusCode || 0, data });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loginOnce() {
  const res = await httpJson('POST', `${SERVER_URL}/api/auth/login`, {
    email: EMAIL,
    password: PASSWORD,
  });
  if (res.status >= 400 || !res.data?.token) {
    const msg = res.data?.message || res.data?.errors?.[0]?.msg || `HTTP ${res.status}`;
    throw new Error(`Login failed: ${msg}`);
  }
  authToken = res.data.token;
  authRole = String(res.data.user?.role || '');
  const name = res.data.user?.fullName || EMAIL;
  console.log(`✅ Logged in as ${name} (role: ${authRole})`);
  if (!/^scanner[123]$/.test(authRole)) {
    console.warn('⚠️  Account role is not scanner1/2/3 — station may not lock correctly');
  }
}

async function login() {
  let lastErr = null;
  for (let attempt = 1; attempt <= LOGIN_RETRIES; attempt++) {
    try {
      await loginOnce();
      return;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(15000, 1500 * attempt);
      console.warn(`⚠️  Login attempt ${attempt}/${LOGIN_RETRIES} failed: ${err.message}`);
      if (attempt < LOGIN_RETRIES) {
        console.log(`   Retrying in ${Math.round(wait / 1000)}s...`);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error('Login failed');
}

async function ensureAuth() {
  if (!authToken) await login();
}

async function scanCode(rawCode) {
  const code = String(rawCode || '')
    .replace(/[\r\n\t]+/g, '')
    .replace(/[\u064B-\u065F\u0670\u200e\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
  if (!code || code.length < MIN_CODE_LEN) return;
  if (busy) {
    console.log(`⏭️  Busy — skipped: ${code}`);
    return;
  }

  busy = true;
  console.log(`\n📷 Scan: ${code}`);
  try {
    await ensureAuth();
    let res = await httpJson(
      'POST',
      `${SERVER_URL}/api/cases/scan`,
      { caseNumber: code },
      { Authorization: `Bearer ${authToken}` }
    );

    if (res.status === 401) {
      console.log('🔄 Token expired — re-login...');
      authToken = '';
      await login();
      res = await httpJson(
        'POST',
        `${SERVER_URL}/api/cases/scan`,
        { caseNumber: code },
        { Authorization: `Bearer ${authToken}` }
      );
    }

    if (res.status >= 200 && res.status < 300 && res.data?.success) {
      console.log(`✅ ${res.data.message || 'OK'}`);
      if (res.data.case?.currentStage) {
        console.log(`   → stage: ${res.data.case.currentStage}`);
      }
      beep(true);
    } else {
      const msg = res.data?.message || res.data?.error || `HTTP ${res.status}`;
      console.error(`❌ ${msg}`);
      beep(false);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    beep(false);
  } finally {
    busy = false;
  }
}

function keyNameToChar(name) {
  const n = String(name || '').toUpperCase();
  if (/^[A-Z]$/.test(n)) return n;
  if (/^[0-9]$/.test(n)) return n;
  if (n === 'MINUS' || n === 'DASH' || n.includes('HYPHEN')) return '-';
  if (n.startsWith('NUMPAD ') || n.startsWith('NUMPAD')) {
    const d = n.replace(/NUMPAD\s*/i, '');
    if (/^[0-9]$/.test(d)) return d;
    if (d === 'MINUS' || d === '-') return '-';
  }
  return null;
}

function isEnterKey(name) {
  const n = String(name || '').toUpperCase();
  return n === 'RETURN' || n === 'ENTER' || n === 'NUMPAD ENTER';
}

function onBarcodeChar(ch) {
  const now = Date.now();
  if (buffer && now - lastKeyAt > KEY_GAP_MS) {
    // Gap too long → start fresh (human typing / interrupted)
    buffer = '';
  }
  lastKeyAt = now;
  buffer += ch;
}

function onBarcodeEnter() {
  const code = buffer;
  buffer = '';
  lastKeyAt = 0;
  if (!code) return;
  // Ignore slow/human short fragments
  void scanCode(code);
}

function startGlobalKeyboard() {
  try {
    const { GlobalKeyboardListener } = require('node-global-key-listener');
    const listener = new GlobalKeyboardListener();
    listener.addListener((e) => {
      if (e.state !== 'DOWN') return;
      if (isEnterKey(e.name)) {
        onBarcodeEnter();
        return;
      }
      const ch = keyNameToChar(e.name);
      if (ch) onBarcodeChar(ch);
    });
    console.log('⌨️  Global keyboard hook active — scan anytime (no browser needed)');
    console.log('   Tip: keep English keyboard layout if wedge still remaps oddly');
    return true;
  } catch (err) {
    console.warn(`⚠️  Global keyboard hook unavailable (${err.message})`);
    return false;
  }
}

function startStdinFallback() {
  console.log('⌨️  Fallback: type/scan into THIS window, then Enter');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    void scanCode(line);
  });
}

function enableKeepAwake() {
  if (process.platform !== 'win32') return;
  try {
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SleepPreventer {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
  public static void StayAwake() {
    SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002);
  }
}
"@
[SleepPreventer]::StayAwake()
`;
    const refresh = () => {
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => {});
    };
    refresh();
    setInterval(refresh, 60000);
    console.log('☕ Keep-awake enabled');
  } catch {
    /* ignore */
  }
}

async function main() {
  enableKeepAwake();

  // Keep trying forever until first login succeeds (Railway cold start / flaky net)
  for (;;) {
    try {
      await login();
      break;
    } catch (err) {
      console.error(`❌ Cannot reach server yet: ${err.message}`);
      console.log('   Waiting 10s then trying again... (check internet / Railway)');
      await sleep(10000);
    }
  }

  setInterval(() => {
    loginOnce().catch((err) => console.warn('⚠️  Re-login failed:', err.message));
  }, TOKEN_REFRESH_MS);

  const hooked = startGlobalKeyboard();
  if (!hooked) startStdinFallback();

  console.log('\n✅ Ready — waiting for barcode scans...\n');
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
