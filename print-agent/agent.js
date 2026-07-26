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

    // 3. Print silently
    await print(pdfPath, { printer: PRINTER_NAME });
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

// ── Generate PDF from HTML ────────────────────────────────
async function generatePdf(html, outputPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', right: '20mm', bottom: '15mm', left: '20mm' },
  });
  await browser.close();
}

// ── Build HTML print template ─────────────────────────────
function buildPrintHtml(c) {
  const printDate = c.printDate || new Date().toLocaleDateString('en-GB');
  const workTypeDisplay = c.workType || '—';
  const quantity = c.caseType === 'Empty' ? 0 : (c.quantity || 0);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>ريكويست</title>
  <style>
    @page { size: A4; margin: 0mm 20mm 15mm 20mm; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { margin: 0; padding: 0; background: #fff; color: #000; font-size: 19px; }
    .section { margin: 22px 0; }
    .section-title { font-size: 17px; font-weight: bold; border-right: 4px solid #000; padding-right: 12px; margin-bottom: 12px; color: #222; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 18px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: bold; text-align: left; }
    .footer { margin-top: 30px; padding-top: 14px; border-top: 2px solid #000; display: flex; justify-content: flex-end; font-size: 15px; color: #555; }
    .footer-brand { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .footer-brand-name { font-weight: bold; font-size: 16px; color: #222; }
    .footer-date { font-size: 13px; color: #666; }
    .teeth-section { margin-top: 36px; }
    .teeth-title { font-size: 17px; font-weight: bold; border-right: 4px solid #000; padding-right: 12px; margin-bottom: 14px; color: #222; }
    .teeth-table { width: 100%; border-collapse: collapse; font-size: 17px; }
    .teeth-table th { background: #2980b9; color: #fff; text-align: center; padding: 8px 0; font-size: 18px; font-weight: bold; width: 50%; }
    .teeth-table td { text-align: center; padding: 10px 2px; font-size: 18px; font-weight: bold; width: 6.25%; }
    .teeth-table .divider td { border-top: 2px solid #333; padding: 0; height: 0; }
    .center-line { border-right: 2px solid #333; }
  </style>
</head>
<body>

  <div class="section">
    <div class="section-title">بيانات الطبيب والمريض</div>
    <div class="row"><span class="label">الطبيب</span><span class="value">${c.doctor || '—'}</span></div>
    <div class="row"><span class="label">المريض</span><span class="value">${c.patient || '—'}</span></div>
  </div>

  <div class="section">
    <div class="section-title">تفاصيل العمل</div>
    <div class="row"><span class="label">نوع العمل</span><span class="value">${workTypeDisplay || '—'}</span></div>
    ${c.workDetail ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${c.workDetail}</span></div>` : ''}
    <div class="row"><span class="label">اللون</span><span class="value">${c.color || '—'}</span></div>
    <div class="row"><span class="label">إجمالي العدد</span><span class="value">${quantity}</span></div>
  </div>

  <div class="teeth-section">
    <div class="teeth-title">مخطط الأسنان</div>
    <table class="teeth-table" dir="ltr">
      <thead>
        <tr><th colspan="8">R</th><th colspan="8">L</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>8</td><td>7</td><td>6</td><td>5</td><td>4</td><td>3</td><td>2</td><td class="center-line">1</td>
          <td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td>
        </tr>
        <tr class="divider"><td colspan="16"></td></tr>
        <tr>
          <td>8</td><td>7</td><td>6</td><td>5</td><td>4</td><td>3</td><td>2</td><td class="center-line">1</td>
          <td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <div class="footer-brand">
      <span class="footer-brand-name">Elegance Dental Lab</span>
      <span class="footer-date">تاريخ الطباعة: ${printDate}</span>
    </div>
  </div>

</body>
</html>`;
}
