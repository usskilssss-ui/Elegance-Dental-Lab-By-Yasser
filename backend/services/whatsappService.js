/**
 * WhatsApp notifications via UltraMsg, Meta Cloud API, or WhatsApp Web (Baileys).
 * Config from: Admin UI (Mongo AppSettings) OR env vars.
 */
const User = require('../models/User');
const DentalCase = require('../models/DentalCase');

const DEFAULT_MSG_COMPLETED =
  '{lab}\nحالة ({patient})\n{workType} — {quantity} قطعة\nجاهزة للاستلام تواصل مع المعمل لاستلام الحالة';
const DEFAULT_MSG_EXITED =
  '{lab}\nحالة ({patient})\n{workType} — {quantity} قطعة\nتم التسليم / خرجت من المعمل';
const DEFAULT_MSG_DAILY =
  '{lab} — ملخص يومي\nعندك {count} حالات جاهزة للاستلام.\n{list}';
const OLD_MSG_COMPLETED =
  '{lab}\nالحالة {caseNumber} للمريض {patient} أصبحت منتهية وجاهزة.';
const OLD_MSG_EXITED =
  '{lab}\nالحالة {caseNumber} للمريض {patient} تم تسليمها/خرجت من المعمل.';

function normalizeMsgTemplate(saved, oldDefault, nextDefault) {
  const text = String(saved || '').trim();
  if (!text || text === oldDefault) return nextDefault;
  return text;
}

function parseNotesMeta(notes) {
  const prefix = '__META__\n';
  if (!notes || typeof notes !== 'string' || !notes.startsWith(prefix)) return {};
  try {
    return JSON.parse(notes.slice(prefix.length));
  } catch {
    return {};
  }
}

function caseMessageVars(dentalCase) {
  const meta = parseNotesMeta(dentalCase?.notes || '');
  const workType =
    String(meta.workType || dentalCase?.caseType || '').trim() || '—';
  const qtyRaw = meta.quantity ?? meta.qty;
  const quantity =
    qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== '' && !Number.isNaN(Number(qtyRaw))
      ? String(Number(qtyRaw))
      : '1';
  return {
    lab: labLabel(),
    caseNumber: dentalCase?.caseNumber || '',
    patient: dentalCase?.patientName || '—',
    workType,
    quantity,
  };
}

/** @type {null | { enabled: boolean, provider: string, token: string, instanceId: string, phoneNumberId: string, dailyHour: number, labName: string, msgCompleted: string, msgExited: string, msgDaily: string }} */
let cachedConfig = null;

function configFromEnv() {
  const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();
  return {
    enabled: !!provider,
    provider,
    token: String(process.env.WHATSAPP_TOKEN || ''),
    instanceId: String(process.env.WHATSAPP_INSTANCE_ID || ''),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || ''),
    dailyHour: Number(process.env.WHATSAPP_DAILY_HOUR || 18),
    labName: String(process.env.WHATSAPP_LAB_NAME || 'Elegance Dental Lab'),
    msgCompleted: DEFAULT_MSG_COMPLETED,
    msgExited: DEFAULT_MSG_EXITED,
    msgDaily: DEFAULT_MSG_DAILY,
  };
}

function applyTemplate(template, vars) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars || {})) {
    out = out.split(`{${key}}`).join(String(value ?? ''));
  }
  return out;
}

async function reloadWhatsAppConfig() {
  try {
    const AppSettings = require('../models/AppSettings');
    const doc = await AppSettings.findOne({ key: 'app' }).lean();
    if (
      doc?.whatsapp &&
      (doc.whatsapp.enabled ||
        doc.whatsapp.token ||
        String(doc.whatsapp.provider || '').toLowerCase() === 'waweb')
    ) {
      cachedConfig = {
        enabled: !!doc.whatsapp.enabled,
        provider: String(doc.whatsapp.provider || 'ultramsg').toLowerCase(),
        token: String(doc.whatsapp.token || ''),
        instanceId: String(doc.whatsapp.instanceId || ''),
        phoneNumberId: String(doc.whatsapp.phoneNumberId || ''),
        dailyHour: Number(doc.whatsapp.dailyHour ?? 18),
        labName: String(doc.whatsapp.labName || 'Elegance Dental Lab'),
        msgCompleted: normalizeMsgTemplate(
          doc.whatsapp.msgCompleted,
          OLD_MSG_COMPLETED,
          DEFAULT_MSG_COMPLETED
        ),
        msgExited: normalizeMsgTemplate(
          doc.whatsapp.msgExited,
          OLD_MSG_EXITED,
          DEFAULT_MSG_EXITED
        ),
        msgDaily: String(doc.whatsapp.msgDaily || DEFAULT_MSG_DAILY),
      };
      return cachedConfig;
    }
  } catch (err) {
    console.warn('[whatsapp] reload from DB failed:', err.message);
  }
  cachedConfig = configFromEnv();
  return cachedConfig;
}

function getConfig() {
  if (cachedConfig) return cachedConfig;
  cachedConfig = configFromEnv();
  return cachedConfig;
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = `20${p.slice(1)}`;
  return p;
}

function providerConfigured() {
  const c = getConfig();
  if (c.provider === 'waweb') {
    if (!c.enabled) return false;
    try {
      const { isWhatsAppWebConnected } = require('./waWebService');
      return isWhatsAppWebConnected();
    } catch {
      return false;
    }
  }
  // Env-only configs may have enabled inferred from provider string
  const on = c.enabled || !!(c.token && (c.instanceId || c.phoneNumberId));
  if (!on) return false;
  if (c.provider === 'meta') return !!(c.token && c.phoneNumberId);
  if (c.provider === 'ultramsg') return !!(c.token && c.instanceId);
  return false;
}

async function sendWhatsAppText(phone, body) {
  if (!cachedConfig) await reloadWhatsAppConfig();
  if (!providerConfigured()) {
    console.log('[whatsapp] skipped (not configured):', String(body).slice(0, 80));
    return { ok: false, skipped: true };
  }
  const to = normalizePhone(phone);
  if (!to) return { ok: false, error: 'no-phone' };

  const c = getConfig();
  const text = String(body);

  try {
    if (c.provider === 'waweb') {
      const { sendWhatsAppWebText } = require('./waWebService');
      return sendWhatsAppWebText(phone, text);
    }

    if (c.provider === 'meta') {
      const res = await fetch(`https://graph.facebook.com/v19.0/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn('[whatsapp] meta error:', res.status, errText);
        return { ok: false, error: errText };
      }
      return { ok: true };
    }

    if (c.provider === 'ultramsg') {
      const instance = c.instanceId.replace(/^instance/i, '');
      const instancePath = c.instanceId.startsWith('instance')
        ? c.instanceId
        : `instance${instance}`;
      const params = new URLSearchParams({
        token: c.token,
        to: `${to}@c.us`,
        body: text,
      });
      const res = await fetch(`https://api.ultramsg.com/${instancePath}/messages/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn('[whatsapp] ultramsg error:', res.status, errText);
        return { ok: false, error: errText };
      }
      return { ok: true };
    }
  } catch (err) {
    console.warn('[whatsapp] send failed:', err.message);
    return { ok: false, error: err.message };
  }
  return { ok: false, skipped: true };
}

function normalizeDoctorKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function findDoctorUserByCase(dentalCase) {
  const doctorName = String(dentalCase?.referringDoctor || '').trim();
  if (!doctorName) return null;
  const users = await User.find({ role: 'doctor', isActive: true }).select('fullName phone email');
  const key = normalizeDoctorKey(doctorName);
  return users.find((u) => normalizeDoctorKey(u.fullName) === key) || null;
}

function labLabel() {
  return getConfig().labName || 'Elegance Dental Lab';
}

async function notifyDoctorCaseStatus(dentalCase, kind) {
  try {
    if (!cachedConfig) await reloadWhatsAppConfig();
    const c = getConfig();
    // WhatsApp Web: only notify when case is completed (lower ban risk)
    if (c.provider === 'waweb' && kind !== 'completed') {
      console.log('[whatsapp] waweb skip non-completed:', kind, dentalCase?.caseNumber);
      return;
    }
    const doctor = await findDoctorUserByCase(dentalCase);
    if (!doctor?.phone) {
      console.log('[whatsapp] no doctor phone for', dentalCase?.caseNumber);
      return;
    }
    const vars = { ...caseMessageVars(dentalCase), count: '', list: '' };
    let msg = '';
    if (kind === 'completed') {
      msg = applyTemplate(c.msgCompleted || DEFAULT_MSG_COMPLETED, vars);
    } else if (kind === 'exited') {
      msg = applyTemplate(c.msgExited || DEFAULT_MSG_EXITED, vars);
    } else {
      msg = applyTemplate('{lab}\nتحديث على الحالة ({patient}).', vars);
    }
    await sendWhatsAppText(doctor.phone, msg);
  } catch (err) {
    console.warn('[whatsapp] notifyDoctorCaseStatus:', err.message);
  }
}

async function sendDailyReadySummaries() {
  if (!cachedConfig) await reloadWhatsAppConfig();
  if (getConfig().provider === 'waweb') {
    console.log('[whatsapp] daily summary skipped for waweb (completed-only mode)');
    return;
  }
  if (!providerConfigured()) {
    console.log('[whatsapp] daily summary skipped (not configured)');
    return;
  }
  try {
    const ready = await DentalCase.find({
      currentStage: 'completed',
      status: { $ne: 'exited' },
    })
      .select('referringDoctor caseNumber patientName')
      .lean();

    const byDoctor = new Map();
    for (const c of ready) {
      const key = normalizeDoctorKey(c.referringDoctor);
      if (!key) continue;
      if (!byDoctor.has(key)) byDoctor.set(key, []);
      byDoctor.get(key).push(c);
    }

    const doctors = await User.find({ role: 'doctor', isActive: true }).select('fullName phone');
    for (const doc of doctors) {
      const list = byDoctor.get(normalizeDoctorKey(doc.fullName)) || [];
      if (!list.length || !doc.phone) continue;
      const listText =
        list
          .slice(0, 8)
          .map((c) => `• ${c.caseNumber} — ${c.patientName}`)
          .join('\n') + (list.length > 8 ? `\n… و${list.length - 8} أخرى` : '');
      const msg = applyTemplate(getConfig().msgDaily || DEFAULT_MSG_DAILY, {
        lab: labLabel(),
        caseNumber: '',
        patient: '',
        count: String(list.length),
        list: listText,
      });
      await sendWhatsAppText(doc.phone, msg);
    }
  } catch (err) {
    console.warn('[whatsapp] daily summary failed:', err.message);
  }
}

function scheduleDailyWhatsAppSummary() {
  reloadWhatsAppConfig()
    .then(() => {
      console.log(
        providerConfigured()
          ? `[whatsapp] ready (daily ~${getConfig().dailyHour}:00)`
          : '[whatsapp] idle — configure from Admin → واتساب'
      );
    })
    .catch(() => {});

  const tick = async () => {
    await reloadWhatsAppConfig();
    if (!providerConfigured()) return;
    const hour = getConfig().dailyHour ?? 18;
    const now = new Date();
    if (now.getHours() === hour && now.getMinutes() < 5) {
      const key = now.toISOString().slice(0, 10);
      if (scheduleDailyWhatsAppSummary._lastRun === key) return;
      scheduleDailyWhatsAppSummary._lastRun = key;
      await sendDailyReadySummaries();
    }
  };
  setInterval(tick, 60 * 1000);
}

module.exports = {
  sendWhatsAppText,
  notifyDoctorCaseStatus,
  sendDailyReadySummaries,
  scheduleDailyWhatsAppSummary,
  providerConfigured,
  reloadWhatsAppConfig,
};
