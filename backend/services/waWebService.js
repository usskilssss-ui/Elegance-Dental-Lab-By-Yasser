/**
 * Unofficial WhatsApp Web bridge (Baileys).
 * Session persisted in Mongo so Railway restarts keep the link when possible.
 *
 * Send path kept simple on purpose: `${digits}@s.whatsapp.net`.
 * onWhatsApp/LID rewriting previously returned "ok" while phones never received messages.
 */
const mongoose = require('mongoose');
const QRCode = require('qrcode');

let sock = null;
let starting = false;
let lastQrDataUrl = '';
let connectionStatus = 'disconnected'; // disconnected | qr | connecting | open
let lastError = '';
let saveCreds = null;
let reconnectTimer = null;

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

function linkedAccountDigits() {
  const id = sock?.user?.id || sock?.authState?.creds?.me?.id || '';
  const raw = String(id).split(':')[0].split('@')[0].replace(/\D/g, '');
  if (raw && raw.length >= 10 && raw.length <= 15) return raw;
  return '';
}

function getPublicStatus() {
  return {
    status: connectionStatus,
    connected: connectionStatus === 'open',
    qr: connectionStatus === 'qr' ? lastQrDataUrl : '',
    error: lastError || '',
    linkedPhone: linkedAccountDigits() || '',
  };
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(delayMs = 1500) {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsAppWeb().catch((e) => {
      lastError = e.message || String(e);
    });
  }, delayMs);
}

/** Egyptian mobiles: 01xxxxxxxxx → 20xxxxxxxxxx */
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
  if (!to) return { ok: false, error: 'رقم الموبايل غير صالح' };

  const jid = `${to}@s.whatsapp.net`;
  const text = String(body || '');
  console.log('[wa-web] sending to', jid, `(raw=${String(phone)})`);

  try {
    await sock.sendMessage(jid, { text });
    console.log('[wa-web] send OK', { to, jid });
    return { ok: true, to, jid };
  } catch (err) {
    console.warn('[wa-web] send failed:', to, err.message);
    return { ok: false, error: err.message || 'send failed', to, jid };
  }
}

async function startWhatsAppWeb(options = {}) {
  const force = !!options.force;
  if (force) {
    clearReconnectTimer();
    try {
      if (sock) {
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
    try {
      await WaAuth().deleteMany({});
    } catch {
      /* ignore */
    }
  }

  if (starting) return getPublicStatus();
  if (sock && (connectionStatus === 'open' || connectionStatus === 'qr' || connectionStatus === 'connecting')) {
    return getPublicStatus();
  }

  starting = true;
  lastError = '';
  connectionStatus = 'connecting';
  lastQrDataUrl = '';
  clearReconnectTimer();

  try {
    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
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
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 20_000,
      getMessage: async () => undefined,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          lastQrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
          });
          connectionStatus = 'qr';
          lastError = '';
        } catch (err) {
          lastError = err.message || 'QR encode failed';
          connectionStatus = 'disconnected';
        }
      }

      if (connection === 'open') {
        connectionStatus = 'open';
        lastQrDataUrl = '';
        lastError = '';
        console.log('[wa-web] connected as', linkedAccountDigits() || sock?.user?.id || '?');
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const restartRequired = statusCode === DisconnectReason.restartRequired;
        connectionStatus = 'disconnected';
        lastQrDataUrl = '';
        sock = null;
        console.warn('[wa-web] closed', statusCode, loggedOut ? '(logged out)' : restartRequired ? '(restart required)' : '');

        if (loggedOut) {
          lastError = 'تم تسجيل الخروج — اضغط ربط واتساب وامسح QR من جديد';
          try {
            await WaAuth().deleteMany({});
          } catch {
            /* ignore */
          }
          return;
        }

        if (restartRequired) {
          lastError = 'جاري إكمال الربط…';
          scheduleReconnect(800);
          return;
        }

        lastError = `انقطع الاتصال (${statusCode || 'unknown'}) — جاري إعادة المحاولة`;
        scheduleReconnect(2500);
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
  clearReconnectTimer();
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

function isWhatsAppWebConnected() {
  return connectionStatus === 'open' && !!sock;
}

module.exports = {
  startWhatsAppWeb,
  stopWhatsAppWeb,
  getPublicStatus,
  sendWhatsAppWebText,
  isWhatsAppWebConnected,
  normalizeWaWebPhone,
};
