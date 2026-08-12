/**
 * Unofficial WhatsApp Web bridge (Baileys).
 * Session persisted in Mongo so Railway restarts keep the link when possible.
 */
const mongoose = require('mongoose');
const QRCode = require('qrcode');

let sock = null;
let starting = false;
let lastQrDataUrl = '';
let connectionStatus = 'disconnected'; // disconnected | qr | connecting | open
let lastError = '';
let saveCreds = null;

const WaAuthSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

function WaAuth() {
  return mongoose.models.WaAuth || mongoose.model('WaAuth', WaAuthSchema);
}

async function useMongoAuthState() {
  const Model = WaAuth();
  const {
    initAuthCreds,
    BufferJSON,
    proto,
  } = require('@whiskeysockets/baileys');

  const write = async (key, data) => {
    if (data == null) {
      await Model.deleteOne({ key });
      return;
    }
    const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    await Model.updateOne({ key }, { $set: { data: serialized } }, { upsert: true });
  };

  const read = async (key) => {
    const doc = await Model.findOne({ key }).lean();
    if (!doc?.data) return null;
    return JSON.parse(JSON.stringify(doc.data), BufferJSON.reviver);
  };

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          for (const id of ids) {
            let value = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category] || {})) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : Model.deleteOne({ key }));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => write('creds', creds),
  };
}

function getPublicStatus() {
  return {
    status: connectionStatus,
    connected: connectionStatus === 'open',
    qr: connectionStatus === 'qr' ? lastQrDataUrl : '',
    error: lastError || '',
  };
}

async function startWhatsAppWeb() {
  if (starting) return getPublicStatus();
  if (sock && connectionStatus === 'open') return getPublicStatus();

  starting = true;
  lastError = '';
  connectionStatus = 'connecting';
  lastQrDataUrl = '';

  try {
    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = require('@whiskeysockets/baileys');
    const { Boom } = require('@hapi/boom');
    const pino = require('pino');

    const auth = await useMongoAuthState();
    saveCreds = auth.saveCreds;
    const { version } = await fetchLatestBaileysVersion();

    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
      sock = null;
    }

    sock = makeWASocket({
      version,
      auth: auth.state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Elegance Dental Lab', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          lastQrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 280,
          });
          connectionStatus = 'qr';
        } catch (err) {
          lastError = err.message || 'QR encode failed';
          connectionStatus = 'disconnected';
        }
      }

      if (connection === 'open') {
        connectionStatus = 'open';
        lastQrDataUrl = '';
        lastError = '';
        console.log('[wa-web] connected');
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        connectionStatus = 'disconnected';
        lastQrDataUrl = '';
        sock = null;
        console.warn('[wa-web] closed', statusCode, loggedOut ? '(logged out)' : '');
        if (!loggedOut) {
          // Auto-reconnect after brief delay
          setTimeout(() => {
            startWhatsAppWeb().catch((e) => {
              lastError = e.message || String(e);
            });
          }, 2500);
        } else {
          lastError = 'تم تسجيل الخروج — امسح QR من جديد';
        }
      }
    });
  } catch (err) {
    lastError = err.message || String(err);
    connectionStatus = 'disconnected';
    console.error('[wa-web] start failed:', lastError);
  } finally {
    starting = false;
  }

  return getPublicStatus();
}

async function stopWhatsAppWeb(logout = false) {
  try {
    if (logout && sock) {
      try {
        await sock.logout();
      } catch {
        /* ignore */
      }
      const Model = WaAuth();
      await Model.deleteMany({});
    } else if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
  } finally {
    sock = null;
    connectionStatus = 'disconnected';
    lastQrDataUrl = '';
  }
  return getPublicStatus();
}

function normalizeWaWebPhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = `20${p.slice(1)}`;
  return p;
}

async function sendWhatsAppWebText(phone, body) {
  if (!sock || connectionStatus !== 'open') {
    return { ok: false, error: 'واتساب Web مش متصل — امسح QR من الأدمن' };
  }
  const to = normalizeWaWebPhone(phone);
  if (!to) return { ok: false, error: 'no-phone' };
  try {
    const jid = `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: String(body || '') });
    return { ok: true };
  } catch (err) {
    console.warn('[wa-web] send failed:', err.message);
    return { ok: false, error: err.message || 'send failed' };
  }
}

function isWhatsAppWebConnected() {
  return connectionStatus === 'open' && !!sock;
}

module.exports = {
  startWhatsAppWeb,
  stopWhatsAppWeb,
  getPublicStatus,
  sendWhatsAppWebText,
  isWhatsAppWebConnected,
};
