/**
 * Elegance Dental Lab — Station Scan Agent
 * Runs on a lab Windows PC next to a USB barcode scanner (keyboard wedge).
 * Logs in as scanner1 / scanner2 / scanner3 and POSTs scanned codes to /api/cases/scan.
 *
 * Primary capture: local Capture page (auto-focused). Console stdin as backup.
 *
 * Usage:
 *   node agent.js config.scanner2.json
 *   npm run start:2
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile, exec } = require('child_process');
const readline = require('readline');

// Never crash the agent on optional hook / spawn noise
process.on('uncaughtException', (err) => {
  console.warn('⚠️  Ignored error:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.warn('⚠️  Ignored rejection:', err && err.message ? err.message : err);
});

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
const CAPTURE_PORT = Number(config.CAPTURE_PORT) || 3921;
const OPEN_CAPTURE_UI = config.OPEN_CAPTURE_UI !== false;

if (!SERVER_URL || !EMAIL || !PASSWORD) {
  console.error('❌ Config needs SERVER_URL, EMAIL, PASSWORD');
  process.exit(1);
}

let authToken = '';
let authRole = '';
let busy = false;
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
        family: 4,
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
    console.warn('   Fix the employee position in Admin to سكان 1 / 2 / 3');
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
  if (!code) return { ok: false, message: 'Empty code' };
  if (code.length < MIN_CODE_LEN) {
    console.log(`⏭️  Ignored short code: "${code}"`);
    return { ok: false, message: 'Short code' };
  }
  if (busy) {
    console.log(`⏭️  Busy — skipped: ${code}`);
    return { ok: false, message: 'Busy' };
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
      const message = res.data.message || 'OK';
      console.log(`✅ ${message}`);
      if (res.data.case?.currentStage) {
        console.log(`   → stage: ${res.data.case.currentStage}`);
      }
      beep(true);
      return { ok: true, message, stage: res.data.case?.currentStage };
    }

    const message = res.data?.message || res.data?.error || `HTTP ${res.status}`;
    console.error(`❌ ${message}`);
    beep(false);
    return { ok: false, message };
  } catch (err) {
    console.error(`❌ ${err.message}`);
    beep(false);
    return { ok: false, message: err.message };
  } finally {
    busy = false;
  }
}

function startStdinFallback() {
  console.log('⌨️  Console input ON — click this black window, then scan (backup)');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    void scanCode(line);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capturePageHtml() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(LABEL)}</title>
  <style>
    html, body { height: 100%; margin: 0; font-family: Segoe UI, Tahoma, sans-serif; background: #0f172a; color: #e2e8f0; }
    .wrap { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; }
    h1 { margin: 0; font-size: 22px; }
    p { margin: 0; opacity: .8; text-align: center; max-width: 480px; }
    input {
      width: min(520px, 92vw); font-size: 22px; padding: 14px 16px; border-radius: 10px;
      border: 2px solid #38bdf8; background: #020617; color: #f8fafc; direction: ltr; text-align: center;
    }
    .log { min-height: 28px; font-size: 16px; font-weight: 700; text-align: center; max-width: 520px; }
    .ok { color: #4ade80; } .err { color: #f87171; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(LABEL)}</h1>
    <p>امسح الباركود هنا — سيّب الصفحة دي مفتوحة ومختارة</p>
    <input id="scan" autofocus autocomplete="off" spellcheck="false" placeholder="Ready to scan…" />
    <div id="log" class="log"></div>
  </div>
  <script>
    const input = document.getElementById('scan');
    const log = document.getElementById('log');
    function focusScan() { try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); } }
    setInterval(focusScan, 400);
    window.addEventListener('focus', focusScan);
    document.addEventListener('click', focusScan);
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = input.value.trim();
      input.value = '';
      if (!code) return;
      log.textContent = 'Sending ' + code + '…';
      log.className = 'log';
      try {
        const res = await fetch('/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        log.textContent = data.message || (data.ok ? 'OK' : 'Failed');
        log.className = 'log ' + (data.ok ? 'ok' : 'err');
      } catch (err) {
        log.textContent = err.message || 'Error';
        log.className = 'log err';
      }
      focusScan();
    });
  </script>
</body>
</html>`;
}

function startCaptureUi() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
        const html = capturePageHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/scan') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          let code = '';
          try {
            code = JSON.parse(raw || '{}').code || '';
          } catch {
            code = raw;
          }
          const result = await scanCode(code);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

    server.on('error', reject);
    server.listen(CAPTURE_PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${CAPTURE_PORT}/`;
      console.log(`🌐 Capture UI: ${url}`);
      if (OPEN_CAPTURE_UI) {
        const cmd =
          process.platform === 'win32'
            ? `start "" "${url}"`
            : process.platform === 'darwin'
              ? `open "${url}"`
              : `xdg-open "${url}"`;
        exec(cmd, () => {});
      }
      resolve(url);
    });
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

  startStdinFallback();
  await startCaptureUi();

  console.log('\n✅ Ready');
  console.log('   1) Use the Capture page that opened');
  console.log('   2) Scan the barcode there');
  console.log('   3) Keep that page selected (in front)\n');
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
