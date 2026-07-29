/**
 * Elegance Dental Lab — Print Agent
 * Runs on the lab's Windows laptop.
 * Connects to the Railway server via Socket.IO,
 * receives print jobs, renders HTML → PDF → prints silently.
 *
 * Resilience:
 * - Infinite socket reconnect
 * - HTTP poll for pending jobs (catch-up after sleep / disconnect / restart)
 * - Job dedupe so the same request is not printed twice
 * - Windows keep-awake while the agent is running
 */

const { io } = require('socket.io-client');
const puppeteer = require('puppeteer');
const { print, getPrinters } = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SERVER_URL      = config.SERVER_URL.replace(/\/$/, '');
const AGENT_SECRET    = config.PRINT_AGENT_SECRET;
const PRINTER_NAME    = config.PRINTER_NAME;
const RECONNECT_DELAY = 3000; // ms
const POLL_INTERVAL_MS = Number(config.POLL_INTERVAL_MS) || 20000;
const PRINT_CONFIRM_TIMEOUT_MS = Number(config.PRINT_CONFIRM_TIMEOUT_MS) || 90000;
const PRINTER_CHECK_MS = Number(config.PRINTER_CHECK_MS) || 10000;

console.log('🖨️  Elegance Print Agent starting...');
console.log(`   Server  : ${SERVER_URL}`);
console.log(`   Printer : ${PRINTER_NAME}`);
console.log(`   Poll    : every ${POLL_INTERVAL_MS / 1000}s`);
console.log(`   Confirm : ${PRINT_CONFIRM_TIMEOUT_MS / 1000}s spooler timeout`);
console.log(`   Printer check: every ${PRINTER_CHECK_MS / 1000}s`);

// ── Keep Windows from sleeping while agent runs ───────────
function enableKeepAwake() {
  if (process.platform !== 'win32') return;
  try {
    const { execFile } = require('child_process');
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
    // Refresh every 60s so the execution state stays active
    const refresh = () => {
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, () => {});
    };
    refresh();
    setInterval(refresh, 60000);
    console.log('☕ Keep-awake enabled (system will not sleep while agent runs)');
  } catch (err) {
    console.warn('⚠️  Could not enable keep-awake:', err.message);
  }
}
enableKeepAwake();

// ── Connect to server ─────────────────────────────────────
const socket = io(SERVER_URL, {
  auth: { agentSecret: AGENT_SECRET },
  reconnection: true,
  reconnectionDelay: RECONNECT_DELAY,
  reconnectionDelayMax: 15000,
  reconnectionAttempts: Infinity,
  timeout: 20000,
});

socket.on('connect', () => {
  console.log('✅ Connected to server. Waiting for print jobs...');
  // Burst catch-up: network often stabilizes a few seconds after socket reconnect
  catchUpBurst('connect');
});

socket.on('connect_error', (err) => {
  networkDown = true;
  console.error('❌ Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  networkDown = true;
  console.warn('⚠️  Disconnected:', reason, '— will reconnect automatically...');
});

// ── Print Queue Management ────────────────────────────────
const jobQueue = [];
/** IDs currently waiting in the local queue */
const queuedIds = new Set();
/** IDs finished successfully this process lifetime (may still be pending on server if status sync failed) */
const completedIds = new Set();
let currentJobId = null;
let isProcessingQueue = false;
let networkDown = false;
let printerDown = false;
let lastPrinterOk = null;

function normalizeJobId(jobId) {
  return String(jobId);
}

function isPrinterIssueError(message) {
  return /printer|offline|not ready|not found|spooler/i.test(String(message || ''));
}

function isInPipeline(id) {
  return queuedIds.has(id) || currentJobId === id;
}

/**
 * @param {object} job
 * @param {string} source
 * @param {{ fromServerCatchUp?: boolean }} [opts]
 */
function enqueueJob(job, source, opts = {}) {
  const id = normalizeJobId(job.jobId);
  if (!id || id === 'undefined' || id === 'null') {
    console.warn('⚠️  Ignoring job without jobId from', source);
    return false;
  }

  if (isInPipeline(id)) {
    return false;
  }

  // Critical: once printed successfully this session, NEVER reprint —
  // even if a catch-up poll still sees the job as pending/printing (race before done sync).
  if (completedIds.has(id)) {
    console.log(`⏭️  Skip ${id} (already printed this session, via ${source})`);
    return false;
  }

  queuedIds.add(id);
  jobQueue.push({ jobId: id, printData: job.printData || {} });
  console.log(`📥 Queued job ${id} (via ${source})`);
  processQueue();
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapePsSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

async function runPowerShell(script, timeoutMs = 20000) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }
  );
  return String(stdout || '').trim();
}

/** Check printer exists and is not offline / in error via Win32_Printer */
async function getPrinterHealth(printerName) {
  const name = (printerName || '').trim();
  if (!name) {
    return { ok: false, error: 'PRINTER_NAME is empty in config.json' };
  }

  const script = `
$ErrorActionPreference = 'Stop'
$name = '${escapePsSingleQuoted(name)}'
$p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1
if (-not $p) {
  (@{ ok = $false; error = "Printer not found: $name"; offline = $true; status = -1; detectedError = -1 }) | ConvertTo-Json -Compress
  exit 0
}
$offline = [bool]$p.WorkOffline
$status = [int]$p.PrinterStatus
$detected = [int]$p.DetectedErrorState
# Win32 PrinterStatus: 7 = Offline. DetectedErrorState: 2 = No Error; >=3 often paper/toner/jam.
$ok = (-not $offline) -and ($status -ne 7)
if ($detected -ge 3) { $ok = $false }
$errorText = ''
if (-not $ok) {
  if ($offline -or $status -eq 7) { $errorText = "Printer offline: $name" }
  elseif ($detected -ge 3) { $errorText = "Printer error state ($detected): $name" }
  else { $errorText = "Printer not ready: $name" }
}
(@{
  ok = $ok
  error = $errorText
  offline = $offline
  status = $status
  detectedError = $detected
  name = $p.Name
}) | ConvertTo-Json -Compress
`;

  try {
    const raw = await runPowerShell(script);
    const parsed = JSON.parse(raw || '{}');
    return {
      ok: Boolean(parsed.ok),
      error: parsed.error || '',
      offline: Boolean(parsed.offline),
      status: Number(parsed.status),
      detectedError: Number(parsed.detectedError),
      name: parsed.name || name,
    };
  } catch (err) {
    // Fallback: at least verify printer is listed by pdf-to-printer
    try {
      const printers = await getPrinters();
      const found = (printers || []).find(
        (p) => String(p.name || '').toLowerCase() === name.toLowerCase()
      );
      if (!found) {
        return { ok: false, error: `Printer not found: ${name}` };
      }
      return {
        ok: true,
        error: '',
        offline: false,
        status: -1,
        detectedError: -1,
        name,
        warning: `Health check via WMI failed (${err.message}); printer name exists`,
      };
    } catch (e2) {
      return { ok: false, error: `Cannot verify printer: ${err.message}` };
    }
  }
}

async function assertPrinterReady(printerName) {
  const health = await getPrinterHealth(printerName);
  if (!health.ok) {
    throw new Error(health.error || 'Printer is not ready');
  }
  if (health.warning) {
    console.warn(`   ⚠️  ${health.warning}`);
  }
  return health;
}

async function listSpoolerJobs(printerName) {
  const script = `
$ErrorActionPreference = 'Stop'
$name = '${escapePsSingleQuoted(printerName)}'
try {
  $jobs = @(Get-PrintJob -PrinterName $name -ErrorAction Stop | ForEach-Object {
    @{
      id = [string]$_.Id
      status = [string]$_.JobStatus
      name = [string]$_.DocumentName
    }
  })
  ,@($jobs) | ConvertTo-Json -Compress -Depth 4
} catch {
  '[]'
}
`;
  try {
    const raw = await runPowerShell(script);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return [];
  } catch {
    return [];
  }
}

function jobLooksFailed(statusText) {
  const s = String(statusText || '').toLowerCase();
  return /error|offline|paperout|papercritical|userintervention|blocked|deleted/.test(s);
}

function jobLooksPrinted(statusText) {
  const s = String(statusText || '').toLowerCase();
  return /printed|complete|retained/.test(s);
}

/**
 * After sending to Windows spooler, wait until:
 * - new job appears then clears / Printed, OR
 * - printer stays healthy briefly (drivers that don't expose jobs), OR
 * - timeout / offline / error → fail
 */
async function waitForPrintConfirmation(printerName, beforeJobIds) {
  const started = Date.now();
  let sawNewJob = false;
  let healthyEmptyTicks = 0;

  while (Date.now() - started < PRINT_CONFIRM_TIMEOUT_MS) {
    await sleep(500);

    const health = await getPrinterHealth(printerName);
    if (!health.ok) {
      throw new Error(health.error || 'Printer went offline during print');
    }

    const jobs = await listSpoolerJobs(printerName);
    const newJobs = jobs.filter((j) => j && j.id && !beforeJobIds.has(String(j.id)));

    for (const j of newJobs) {
      if (jobLooksFailed(j.status)) {
        throw new Error(`Spooler job failed (${j.status})`);
      }
    }

    if (newJobs.length > 0) {
      sawNewJob = true;
      healthyEmptyTicks = 0;
      if (newJobs.every((j) => jobLooksPrinted(j.status))) {
        return { mode: 'printed-status' };
      }
    } else if (sawNewJob) {
      return { mode: 'spooler-cleared' };
    } else {
      healthyEmptyTicks += 1;
      // Some POS drivers never expose Get-PrintJob; accept only if printer stayed healthy
      // for a few seconds after Windows accepted the print command.
      if (Date.now() - started >= 3500 && healthyEmptyTicks >= 6) {
        return { mode: 'accepted-healthy' };
      }
    }
  }

  throw new Error(`Print confirmation timeout after ${PRINT_CONFIRM_TIMEOUT_MS / 1000}s`);
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    queuedIds.delete(job.jobId);
    currentJobId = job.jobId;

    if (completedIds.has(job.jobId)) {
      console.log(`⏭️  Skip processing ${job.jobId} — already printed this session`);
      currentJobId = null;
      continue;
    }

    console.log(`\n📄 Processing print job: ${job.jobId}`);
    console.log(`   Patient: ${job.printData.patient} | Doctor: ${job.printData.doctor}`);

    try {
      await reportStatus(job.jobId, 'printing');

      await assertPrinterReady(PRINTER_NAME);
      console.log(`   ✅ Printer ready: ${PRINTER_NAME}`);

      const html = buildPrintHtml(job.printData);
      const pdfPath = path.join(os.tmpdir(), `print_job_${job.jobId}.pdf`);
      await generatePdf(html, pdfPath);
      console.log(`   ✅ PDF generated: ${pdfPath}`);

      const beforeJobs = await listSpoolerJobs(PRINTER_NAME);
      const beforeIds = new Set(beforeJobs.map((j) => String(j.id)));

      await printPdf(pdfPath);
      console.log(`   📤 Sent to Windows spooler [${PRINTER_NAME}] — waiting for confirmation...`);

      const confirm = await waitForPrintConfirmation(PRINTER_NAME, beforeIds);
      console.log(`   🖨️  Print confirmed (${confirm.mode}) on [${PRINTER_NAME}]`);

      // Mark done locally FIRST so overlapping catch-up cannot re-queue this job
      completedIds.add(job.jobId);
      await reportStatus(job.jobId, 'done');
      fs.unlink(pdfPath, () => {});
    } catch (err) {
      console.error(`   ❌ Print failed:`, err.message);
      if (completedIds.has(job.jobId)) {
        // Shouldn't happen, but never downgrade a completed print
        console.warn('   ⚠️  Ignoring failure after local completion');
      } else if (isPrinterIssueError(err.message)) {
        printerDown = true;
        await reportStatus(job.jobId, 'pending', `Waiting for printer: ${err.message}`);
        console.log('   ⏳ Job held as pending — will print when printer/agent is back');
      } else {
        await reportStatus(job.jobId, 'failed', err.message);
      }
    } finally {
      currentJobId = null;
    }
  }

  isProcessingQueue = false;
}

async function reportStatus(jobId, status, error) {
  // Never send a downgrade if we already completed this job locally
  if (completedIds.has(normalizeJobId(jobId)) && status !== 'done') {
    console.log(`   ⏭️  Skip status "${status}" for ${jobId} (already completed locally)`);
    return;
  }

  const payload = { jobId, status, error: error || '' };
  if (socket.connected) {
    socket.emit('print:job-status', payload);
  }
  const url = `${SERVER_URL}/api/print/job/${encodeURIComponent(jobId)}/status`;
  try {
    await httpJson('PATCH', url, { status, errorMessage: error || '' });
  } catch (err) {
    console.warn(`   ⚠️  Status HTTP update failed (${status}):`, err.message);
  }
}

// ── Receive print job (realtime) ──────────────────────────
socket.on('print:new-job', (job) => {
  enqueueJob(job, 'socket');
});

// ── HTTP helpers ──────────────────────────────────────────
function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-agent-secret': AGENT_SECRET,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve({});
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchAndEnqueuePending(reason) {
  try {
    const res = await httpJson('GET', `${SERVER_URL}/api/print/jobs/pending`);
    const jobs = res.jobs || [];

    const wasDown = networkDown;
    if (wasDown) {
      console.log('🌐 Network restored — catching up missed print jobs...');
      networkDown = false;
    }

    if (jobs.length === 0) {
      if (reason === 'connect' || String(reason).startsWith('connect') || wasDown) {
        console.log('   No pending jobs to catch up.');
      }
      if (wasDown && reason === 'interval') {
        catchUpBurst('net-restore');
      }
      return true;
    }

    // If printer is down, hold jobs on server as pending — don't burn them as failed
    const health = await getPrinterHealth(PRINTER_NAME);
    if (!health.ok) {
      printerDown = true;
      lastPrinterOk = false;
      console.warn(
        `⏳ Printer not ready (${health.error || 'unknown'}) — holding ${jobs.length} unfinished job(s) until printer is back`
      );
      return true;
    }

    if (printerDown || lastPrinterOk === false) {
      console.log('🖨️  Printer ready — releasing held print jobs...');
      printerDown = false;
    }
    lastPrinterOk = true;

    let added = 0;
    for (const job of jobs) {
      const ok = enqueueJob(job, `poll:${reason}`, { fromServerCatchUp: true });
      if (ok) added += 1;
    }
    console.log(
      `🔁 Catch-up (${reason}): server has ${jobs.length} unfinished job(s), queued ${added} new`
    );
    if (wasDown && reason === 'interval') {
      catchUpBurst('net-restore');
    }
    return true;
  } catch (err) {
    networkDown = true;
    console.warn(`⚠️  Pending poll failed (${reason}):`, err.message);
    return false;
  }
}

/** Several catch-up attempts after reconnect — covers slow DNS / flaky Wi‑Fi / PC boot */
function catchUpBurst(reason) {
  fetchAndEnqueuePending(reason);
  setTimeout(() => fetchAndEnqueuePending(`${reason}+2s`), 2000);
  setTimeout(() => fetchAndEnqueuePending(`${reason}+5s`), 5000);
  setTimeout(() => fetchAndEnqueuePending(`${reason}+15s`), 15000);
  setTimeout(() => fetchAndEnqueuePending(`${reason}+30s`), 30000);
}

// Poll forever — covers sleep wake, missed socket events, and PC restarts
setInterval(() => fetchAndEnqueuePending('interval'), POLL_INTERVAL_MS);

// Watch printer USB/power — when it comes back, print everything waiting
setInterval(async () => {
  try {
    const health = await getPrinterHealth(PRINTER_NAME);
    const ok = Boolean(health.ok);
    if (lastPrinterOk === false && ok) {
      console.log('🖨️  Printer came back online — catching up held jobs...');
      printerDown = false;
      lastPrinterOk = true;
      catchUpBurst('printer-restore');
    } else if (lastPrinterOk === true && !ok) {
      printerDown = true;
      lastPrinterOk = false;
      console.warn(`⚠️  Printer went offline: ${health.error || 'not ready'}`);
    } else if (lastPrinterOk === null) {
      lastPrinterOk = ok;
      printerDown = !ok;
      console.log(ok ? `   Printer status: ready` : `   Printer status: NOT ready (${health.error || ''})`);
    }
  } catch (err) {
    console.warn('⚠️  Printer health check failed:', err.message);
  }
}, PRINTER_CHECK_MS);

// Catch-up on boot / agent restart (laptop was off, service just started)
catchUpBurst('startup');
setTimeout(() => catchUpBurst('startup-late'), 8000);

// Find local Chrome/Edge executable path to avoid downloading Chromium
function getLocalBrowserPath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function printPdf(pdfPath) {
  const options = {};
  if (PRINTER_NAME && PRINTER_NAME.trim()) {
    options.printer = PRINTER_NAME.trim();
  }
  return print(pdfPath, options);
}

async function generatePdf(html, outputPath) {
  const tempHtmlPath = outputPath + '.html';
  fs.writeFileSync(tempHtmlPath, html, 'utf8');

  const browserPath = getLocalBrowserPath();

  if (browserPath) {
    console.log(`   🌐 Generating PDF using native browser: ${browserPath}`);
    try {
      await new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const fileUrl = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
        const args = [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          `--print-to-pdf=${outputPath}`,
          fileUrl,
        ];
        execFile(browserPath, args, (error) => {
          if (error) reject(error);
          else if (!fs.existsSync(outputPath)) reject(new Error('PDF output file was not created'));
          else resolve();
        });
      });
      fs.unlink(tempHtmlPath, () => {});
      return;
    } catch (err) {
      console.warn(`   ⚠️ Native browser PDF generation failed (${err.message}). Trying Puppeteer fallback...`);
    }
  }

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
    '--disable-dev-shm-usage',
  ];

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: browserPath || undefined,
    args: launchArgs,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: outputPath,
    format: 'A5',
    printBackground: true,
    margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
  });
  await browser.close();
  fs.unlink(tempHtmlPath, () => {});
}

function buildPrintHtml(c) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('en-GB');
  const printDate = c.printDate || `${timeStr} ${dateStr}`;
  const workTypeDisplay = c.workType || '—';
  const quantity = c.caseType === 'Empty' ? 0 : (c.quantity || 0);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>ريكويست</title>
  <style>
    @page { size: A5; margin: 10mm 12mm 10mm 12mm; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #fff;
      color: #000;
      font-size: 14px;
      line-height: 1.6;
      direction: rtl;
      padding-top: 120px;
    }
    .section { margin-bottom: 18px; }
    .section-title {
      font-size: 15px; font-weight: 700; color: #000;
      border-right: 4px solid #000; padding-right: 10px; margin-bottom: 8px;
    }
    .row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 7px 0; border-bottom: 1.5px solid #000; font-size: 14px;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #000; font-weight: bold; }
    .value { font-weight: 700; color: #000; text-align: left; direction: ltr; }
    .teeth-section { margin-top: 20px; margin-bottom: 16px; }
    .teeth-title {
      font-size: 15px; font-weight: 700; color: #000;
      border-right: 4px solid #000; padding-right: 10px; margin-bottom: 10px;
    }
    .teeth-chart { width: 100%; direction: ltr; }
    .teeth-chart .side-labels {
      display: flex; justify-content: space-between; padding: 0 4%;
      margin-bottom: 4px; font-size: 13px; font-weight: 700; color: #000;
    }
    .teeth-row { display: flex; width: 100%; border-bottom: 1.5px solid #000; padding: 6px 0; }
    .teeth-row:last-child { border-bottom: none; }
    .teeth-row .tooth { flex: 1; text-align: center; font-size: 14px; font-weight: 700; color: #000; }
    .teeth-row .tooth.center-r { border-right: 2px solid #000; padding-right: 2px; }
    .footer {
      margin-top: 24px; padding-top: 10px; border-top: 2px solid #000;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px; color: #000; direction: ltr;
    }
    .footer-lab { font-weight: 700; color: #000; font-size: 12px; }
    .footer-date { color: #000; font-size: 11px; direction: rtl; }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">بيانات الطبيب والمريض</div>
    <div class="row"><span class="label">الطبيب</span><span class="value">${c.doctor || '—'}</span></div>
    <div class="row"><span class="label">المريض</span><span class="value">${c.patient || '—'}</span></div>
    <div class="row"><span class="label">الفرع</span><span class="value">${c.branch || '—'}</span></div>
  </div>
  <div class="section">
    <div class="section-title">تفاصيل العمل</div>
    <div class="row"><span class="label">نوع العمل</span><span class="value">${workTypeDisplay}</span></div>
    ${c.workDetail ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${c.workDetail}</span></div>` : ''}
    <div class="row"><span class="label">اللون</span><span class="value">${c.color || '—'}</span></div>
    <div class="row"><span class="label">إجمالي العدد</span><span class="value">${quantity}</span></div>
  </div>
  <div class="teeth-section">
    <div class="teeth-title">مخطط الأسنان</div>
    <div class="teeth-chart">
      <div class="side-labels"><span>R</span><span>L</span></div>
      <div class="teeth-row">
        <span class="tooth">8</span><span class="tooth">7</span><span class="tooth">6</span><span class="tooth">5</span>
        <span class="tooth">4</span><span class="tooth">3</span><span class="tooth">2</span><span class="tooth center-r">1</span>
        <span class="tooth">1</span><span class="tooth">2</span><span class="tooth">3</span><span class="tooth">4</span>
        <span class="tooth">5</span><span class="tooth">6</span><span class="tooth">7</span><span class="tooth">8</span>
      </div>
      <div class="teeth-row">
        <span class="tooth">8</span><span class="tooth">7</span><span class="tooth">6</span><span class="tooth">5</span>
        <span class="tooth">4</span><span class="tooth">3</span><span class="tooth">2</span><span class="tooth center-r">1</span>
        <span class="tooth">1</span><span class="tooth">2</span><span class="tooth">3</span><span class="tooth">4</span>
        <span class="tooth">5</span><span class="tooth">6</span><span class="tooth">7</span><span class="tooth">8</span>
      </div>
    </div>
  </div>
  <div class="footer">
    <span class="footer-lab">Elegance Dental Lab</span>
    <span class="footer-date">تاريخ الطباعة: ${printDate}</span>
  </div>
</body>
</html>`;
}
