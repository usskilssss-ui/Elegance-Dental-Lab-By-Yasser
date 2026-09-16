/**
 * Exocad Agent — runs on the design PC next to Exocad.
 * Watches CAD-Data for *.dentalProject files and POSTs them to the lab API.
 *
 * Does NOT create cases. Does NOT change billing.
 * Only sends Exocad project XML for matching against active (non-exited) cases.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Missing config.json — copy config.example.json');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const SERVER_URL = String(config.SERVER_URL || '').replace(/\/$/, '');
const AGENT_SECRET = config.EXOCAD_AGENT_SECRET || config.PRINT_AGENT_SECRET || '';
const CAD_DATA_ROOT = config.CAD_DATA_ROOT || config.CAD_DATA_PATH || '';
const POLL_MS = Number(config.POLL_INTERVAL_MS || config.POLL_MS) || 30000;
const STATE_FILE = path.join(__dirname, 'state.json');

if (!SERVER_URL || !AGENT_SECRET || !CAD_DATA_ROOT) {
  console.error('config.json needs SERVER_URL, EXOCAD_AGENT_SECRET, CAD_DATA_ROOT');
  process.exit(1);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function walkDentalProjects(root, out = []) {
  if (!fs.existsSync(root)) return out;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn('Cannot read', root, err.message);
    return out;
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      walkDentalProjects(full, out);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.dentalproject')) {
      out.push(full);
    }
  }
  return out;
}

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, SERVER_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'x-agent-secret': AGENT_SECRET,
        },
        timeout: 60000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: { raw } });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(data);
    req.end();
  });
}

async function ingestFile(filePath) {
  const xmlContent = fs.readFileSync(filePath, 'utf8');
  const projectFolder = path.dirname(filePath);
  const result = await postJson('/api/exocad/ingest', {
    xmlContent,
    sourceFile: path.basename(filePath),
    projectFolder: path.basename(projectFolder),
  });
  return result;
}

async function scanOnce() {
  const state = loadState();
  const files = walkDentalProjects(CAD_DATA_ROOT);
  console.log(`Scan: ${files.length} dentalProject file(s) under ${CAD_DATA_ROOT}`);

  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const mtimeMs = stat.mtimeMs;
    const prev = state.files[file];
    // Skip unchanged SYNCED files. Retry NO_MATCH / MULTIPLE_MATCHES every 10 min
    // so doctor-mapping / case fixes can take effect without touching the CAD file.
    if (prev && prev.mtimeMs === mtimeMs && prev.ok) {
      const status = String(prev.status || '');
      if (status === 'SYNCED') continue;
      const ageMs = Date.now() - new Date(prev.at || 0).getTime();
      if (Number.isFinite(ageMs) && ageMs < 10 * 60 * 1000) continue;
    }

    try {
      const res = await ingestFile(file);
      const ok = res.status >= 200 && res.status < 300 && res.body?.success !== false;
      state.files[file] = {
        mtimeMs,
        ok,
        status: res.body?.status || '',
        at: new Date().toISOString(),
        http: res.status,
      };
      console.log(
        ok ? '✓' : '✗',
        path.basename(file),
        '→',
        res.body?.status || res.status,
        res.body?.message || ''
      );
      saveState(state);
    } catch (err) {
      console.error('✗', path.basename(file), err.message);
      state.files[file] = {
        mtimeMs,
        ok: false,
        error: err.message,
        at: new Date().toISOString(),
      };
      saveState(state);
    }
  }
}

console.log('Exocad Agent starting...');
console.log('  Server :', SERVER_URL);
console.log('  CAD    :', CAD_DATA_ROOT);
console.log('  Poll   :', POLL_MS, 'ms');

scanOnce().catch((e) => console.error(e));
setInterval(() => {
  scanOnce().catch((e) => console.error(e));
}, POLL_MS);
