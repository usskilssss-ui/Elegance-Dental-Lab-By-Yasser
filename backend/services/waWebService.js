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

function getPublicStatus() {
  return {
    status: connectionStatus,
    connected: connectionStatus === 'open',
    qr: connectionStatus === 'qr' ? lastQrDataUrl : '',
    error: lastError || '',
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

  // Keep an in-progress QR/session alive — killing it mid-scan causes "تعذر ربط الجهاز"
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
      // WhatsApp now expects macOS desktop fingerprint for new pairings
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
        console.log('[wa-web] connected');
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

        // 515 after successful scan is expected — reconnect with saved creds
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

/**
 * Normalize to E.164 digits without +.
 * Egyptian mobiles: 01xxxxxxxxx / 1xxxxxxxxx / 201xxxxxxxxx → 201xxxxxxxxx
 */
function normalizeWaWebPhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  // Local EG: 01xxxxxxxxx (11 digits)
  if (p.startsWith('0') && p.length === 11) p = `20${p.slice(1)}`;
  // Local EG without leading 0: 1xxxxxxxxx (10 digits, mobile)
  else if (p.length === 10 && p.startsWith('1')) p = `20${p}`;
  // Already has country code but was typed as 0201... (13 digits)
  else if (p.startsWith('020') && p.length === 13) p = p.slice(1);
  return p;
}

function linkedAccountDigits() {
  const id = sock?.user?.id || '';
  // e.g. "201033937424:12@s.whatsapp.net" or "201033937424@s.whatsapp.net"
  return String(id).split(':')[0].split('@')[0].replace(/\D/g, '');
}

async function resolveWhatsAppJid(digits) {
  const fallback = `${digits}@s.whatsapp.net`;
  if (typeof sock.onWhatsApp !== 'function') {
    return { jid: fallback, exists: null, via: 'fallback' };
  }
  try {
    // Prefer bare digits — Baileys resolves PN → current jid (incl. LID migration)
    let results = await sock.onWhatsApp(digits);
    if (!Array.isArray(results) || !results.length) {
      results = await sock.onWhatsApp(fallback);
    }
    const hit = Array.isArray(results) ? results.find((r) => r != null) : null;
    if (hit && hit.exists === false) {
      return { jid: null, exists: false, via: 'onWhatsApp' };
    }
    if (hit?.jid) {
      return { jid: hit.jid, exists: true, via: 'onWhatsApp' };
    }
  } catch (err) {
    console.warn('[wa-web] onWhatsApp failed, using fallback jid:', err.message);
  }
  return { jid: fallback, exists: null, via: 'fallback' };
}

async function sendWhatsAppWebText(phone, body) {
  if (!sock || connectionStatus !== 'open') {
    return { ok: false, error: 'واتساب Web مش متصل — امسح QR من الأدمن' };
  }
  const to = normalizeWaWebPhone(phone);
  if (!to) return { ok: false, error: 'رقم الموبايل غير صالح' };
  if (to.length < 10 || to.length > 15) {
    return {
      ok: false,
      error: `رقم غير مكتمل بعد التطبيع (${to}) — استخدم 01xxxxxxxxx أو 201xxxxxxxxx`,
    };
  }

  const selfDigits = linkedAccountDigits();
  if (selfDigits && selfDigits === to) {
    console.warn('[wa-web] send target is the linked account itself:', to);
    return {
      ok: false,
      error:
        'لا يمكن الاعتماد على إرسال لنفس رقم الجهاز المربوط — جرّب رقم واتساب آخر للاختبار',
      to,
      self: true,
    };
  }

  try {
    const resolved = await resolveWhatsAppJid(to);
    if (resolved.exists === false || !resolved.jid) {
      console.warn('[wa-web] number not on WhatsApp:', to);
      return {
        ok: false,
        error: `الرقم ${to} مش مسجّل على واتساب (بعد التطبيع من ${String(phone)})`,
        to,
      };
    }

    const jid = resolved.jid;
    const text = String(body || '');
    console.log('[wa-web] sending to', jid, `(from ${String(phone)} → ${to}, via ${resolved.via})`);

    // Explicit options help some Baileys builds avoid silent drops after LID migration
    let sent;
    try {
      sent = await sock.sendMessage(jid, { text }, { messageId: undefined });
    } catch (primaryErr) {
      console.warn('[wa-web] sendMessage primary failed, retrying bare:', primaryErr.message);
      sent = await sock.sendMessage(jid, { text });
    }

    if (!sent?.key?.id) {
      console.warn('[wa-web] sendMessage returned empty/unconfirmed result for', jid, sent);
      return {
        ok: false,
        error: 'واتساب قبل الطلب لكن مفيش تأكيد إرسال — حاول تاني أو أعد الربط',
        to,
        jid,
      };
    }

    console.log('[wa-web] send OK', {
      to,
      jid,
      messageId: sent.key.id,
      remoteJid: sent.key.remoteJid || jid,
    });
    return { ok: true, to, jid, messageId: sent.key.id };
  } catch (err) {
    console.warn('[wa-web] send failed:', to, err.message);
    return { ok: false, error: err.message || 'send failed', to };
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
  normalizeWaWebPhone,
};
