/**
 * Elegance Dental Lab — Print Agent
 * Runs on the lab's Windows laptop.
 * Connects to the Railway server via Socket.IO,
 * receives print jobs, renders HTML → PDF → prints silently.
 */

const { io } = require('socket.io-client');
const puppeteer = require('puppeteer');
const { print } = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ────────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const SERVER_URL      = config.SERVER_URL;
const AGENT_SECRET    = config.PRINT_AGENT_SECRET;
const PRINTER_NAME    = config.PRINTER_NAME;
const RECONNECT_DELAY = 5000; // ms

console.log('🖨️  Elegance Print Agent starting...');
console.log(`   Server  : ${SERVER_URL}`);
console.log(`   Printer : ${PRINTER_NAME}`);

// ── Connect to server ─────────────────────────────────────
const socket = io(SERVER_URL, {
  auth: { agentSecret: AGENT_SECRET },
  reconnection: true,
  reconnectionDelay: RECONNECT_DELAY,
  reconnectionAttempts: Infinity,
});

socket.on('connect', () => {
  console.log('✅ Connected to server. Waiting for print jobs...');
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.warn('⚠️  Disconnected:', reason, '— will reconnect automatically...');
});

// ── Receive print job ─────────────────────────────────────
socket.on('print:new-job', async (job) => {
  console.log(`\n📄 New print job received: ${job.jobId}`);
  console.log(`   Patient: ${job.printData.patient} | Doctor: ${job.printData.doctor}`);

  try {
    // 1. Build HTML (same template as original)
    const html = buildPrintHtml(job.printData);

    // 2. Generate PDF with Puppeteer
    const pdfPath = path.join(os.tmpdir(), `print_job_${job.jobId}.pdf`);
    await generatePdf(html, pdfPath);
    console.log(`   ✅ PDF generated: ${pdfPath}`);

    // 3. Print silently using SumatraPDF with explicit options (A5, grayscale)
    await printPdf(pdfPath);
    console.log(`   🖨️  Printed successfully on [${PRINTER_NAME}]`);

    // 4. Update job status → done
    socket.emit('print:job-status', { jobId: job.jobId, status: 'done' });

    // 5. Cleanup temp PDF
    fs.unlink(pdfPath, () => {});

  } catch (err) {
    console.error(`   ❌ Print failed:`, err.message);
    socket.emit('print:job-status', { jobId: job.jobId, status: 'failed', error: err.message });
  }
});

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
  return undefined; // fallback
}

// Helper: print PDF using SumatraPDF with forced settings
function printPdf(pdfPath) {
  return new Promise((resolve, reject) => {
    const sumatraPath = path.join(__dirname, 'node_modules', 'pdf-to-printer', 'dist', 'SumatraPDF-3.4.6-32.exe');
    const printTargetArgs = PRINTER_NAME ? ['-print-to', PRINTER_NAME] : ['-print-to-default'];
    const args = [
      ...printTargetArgs,
      '-silent',
      pdfPath,
    ];
    const { execFile } = require('child_process');
    execFile(sumatraPath, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Print failed: ${error.message}`));
      } else {
        resolve();
      }
    });
  });
}

// ── Generate PDF from HTML ────────────────────────────────
async function generatePdf(html, outputPath) {
  const executablePath = getLocalBrowserPath();
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
    '--disable-dev-shm-usage',
  ];

  let browser;
  if (executablePath) {
    try {
      console.log(`   🌐 Using local browser: ${executablePath}`);
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath,
        args: launchArgs,
      });
    } catch (e) {
      console.warn(`   ⚠️ Local browser launch failed (${e.message}), falling back...`);
      browser = await puppeteer.launch({
        headless: 'new',
        args: launchArgs,
      });
    }
  } else {
    browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
    });
  }

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: outputPath,
    format: 'A5',
    printBackground: true,
    margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
  });
  await browser.close();
}

// ── Build HTML print template ─────────────────────────────
function buildPrintHtml(c) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('en-GB'); // dd/mm/yyyy
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

    /* ── Section ─────────────────────────── */
    .section { margin-bottom: 18px; }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #000;
      border-right: 4px solid #000;
      padding-right: 10px;
      margin-bottom: 8px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      border-bottom: 1.5px solid #000;
      font-size: 14px;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #000; font-weight: bold; }
    .value { font-weight: 700; color: #000; text-align: left; direction: ltr; }

    /* ── Teeth Chart ─────────────────────── */
    .teeth-section { margin-top: 20px; margin-bottom: 16px; }
    .teeth-title {
      font-size: 15px;
      font-weight: 700;
      color: #000;
      border-right: 4px solid #000;
      padding-right: 10px;
      margin-bottom: 10px;
    }
    .teeth-chart { width: 100%; direction: ltr; }
    .teeth-chart .side-labels {
      display: flex;
      justify-content: space-between;
      padding: 0 4%;
      margin-bottom: 4px;
      font-size: 13px;
      font-weight: 700;
      color: #000;
    }
    .teeth-row {
      display: flex;
      width: 100%;
      border-bottom: 1.5px solid #000;
      padding: 6px 0;
    }
    .teeth-row:last-child { border-bottom: none; }
    .teeth-row .tooth {
      flex: 1;
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      color: #000;
    }
    .teeth-row .tooth.center-r {
      border-right: 2px solid #000;
      padding-right: 2px;
    }

    /* ── Footer ──────────────────────────── */
    .footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 2px solid #000;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #000;
      direction: ltr;
    }
    .footer-lab { font-weight: 700; color: #000; font-size: 12px; }
    .footer-date { color: #000; font-size: 11px; direction: rtl; }
  </style>
</head>
<body>

  <!-- بيانات الطبيب والمريض -->
  <div class="section">
    <div class="section-title">بيانات الطبيب والمريض</div>
    <div class="row"><span class="label">الطبيب</span><span class="value">${c.doctor || '—'}</span></div>
    <div class="row"><span class="label">المريض</span><span class="value">${c.patient || '—'}</span></div>
  </div>

  <!-- تفاصيل العمل -->
  <div class="section">
    <div class="section-title">تفاصيل العمل</div>
    <div class="row"><span class="label">نوع العمل</span><span class="value">${workTypeDisplay}</span></div>
    ${c.workDetail ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${c.workDetail}</span></div>` : ''}
    <div class="row"><span class="label">اللون</span><span class="value">${c.color || '—'}</span></div>
    <div class="row"><span class="label">إجمالي العدد</span><span class="value">${quantity}</span></div>
  </div>

  <!-- مخطط الأسنان -->
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

  <!-- Footer -->
  <div class="footer">
    <span class="footer-lab">Elegance Dental Lab</span>
    <span class="footer-date">تاريخ الطباعة: ${printDate}</span>
  </div>

</body>
</html>`;
}
