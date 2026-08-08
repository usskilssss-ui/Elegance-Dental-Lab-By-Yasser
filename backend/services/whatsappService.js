/**
 * WhatsApp notifications via Meta Cloud API or UltraMsg.
 * Configure ONE provider with env vars — if unset, calls no-op safely.
 *
 * Meta Cloud API:
 *   WHATSAPP_PROVIDER=meta
 *   WHATSAPP_TOKEN=...
 *   WHATSAPP_PHONE_NUMBER_ID=...
 *
 * UltraMsg:
 *   WHATSAPP_PROVIDER=ultramsg
 *   WHATSAPP_INSTANCE_ID=...
 *   WHATSAPP_TOKEN=...
 */
const User = require('../models/User');
const DentalCase = require('../models/DentalCase');

function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = `20${p.slice(1)}`; // Egypt local → 20…
  return p;
}

function providerConfigured() {
  const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();
  if (provider === 'meta') {
    return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }
  if (provider === 'ultramsg') {
    return !!(process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN);
  }
  return false;
}

async function sendWhatsAppText(phone, body) {
  if (!providerConfigured()) {
    console.log('[whatsapp] skipped (not configured):', body.slice(0, 80));
    return { ok: false, skipped: true };
  }
  const to = normalizePhone(phone);
  if (!to) return { ok: false, error: 'no-phone' };

  const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();

  try {
    if (provider === 'meta') {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const token = process.env.WHATSAPP_TOKEN;
      const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: String(body) },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn('[whatsapp] meta error:', res.status, errText);
        return { ok: false, error: errText };
      }
      return { ok: true };
    }

    if (provider === 'ultramsg') {
      const instance = process.env.WHATSAPP_INSTANCE_ID;
      const token = process.env.WHATSAPP_TOKEN;
      const params = new URLSearchParams({
        token,
        to: to.includes('@') ? to : `${to}@c.us`,
        body: String(body),
      });
      const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
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

async function notifyDoctorCaseStatus(dentalCase, kind) {
  try {
    const doctor = await findDoctorUserByCase(dentalCase);
    if (!doctor?.phone) {
      console.log('[whatsapp] no doctor phone for', dentalCase?.caseNumber);
      return;
    }
    const patient = dentalCase.patientName || '—';
    const num = dentalCase.caseNumber || '';
    let msg = '';
    if (kind === 'completed') {
      msg = `Elegance Dental Lab\nالحالة ${num} للمريض ${patient} أصبحت منتهية وجاهزة.`;
    } else if (kind === 'exited') {
      msg = `Elegance Dental Lab\nالحالة ${num} للمريض ${patient} تم تسليمها/خرجت من المعمل.`;
    } else {
      msg = `Elegance Dental Lab\nتحديث على الحالة ${num} (${patient}).`;
    }
    await sendWhatsAppText(doctor.phone, msg);
  } catch (err) {
    console.warn('[whatsapp] notifyDoctorCaseStatus:', err.message);
  }
}

/** Daily: doctors with completed (ready) non-exited cases */
async function sendDailyReadySummaries() {
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
      const msg =
        `Elegance Dental Lab — ملخص يومي\n` +
        `عندك ${list.length} ${list.length === 1 ? 'حالة جاهزة' : 'حالات جاهزة'} للاستلام.\n` +
        list
          .slice(0, 8)
          .map((c) => `• ${c.caseNumber} — ${c.patientName}`)
          .join('\n') +
        (list.length > 8 ? `\n… و${list.length - 8} أخرى` : '');
      await sendWhatsAppText(doc.phone, msg);
    }
  } catch (err) {
    console.warn('[whatsapp] daily summary failed:', err.message);
  }
}

function scheduleDailyWhatsAppSummary() {
  if (!providerConfigured()) {
    console.log('[whatsapp] daily scheduler idle (provider not configured)');
    return;
  }
  const hour = Number(process.env.WHATSAPP_DAILY_HOUR || 18); // 18:00 server time
  const tick = async () => {
    const now = new Date();
    if (now.getHours() === hour && now.getMinutes() < 5) {
      const key = now.toISOString().slice(0, 10);
      if (scheduleDailyWhatsAppSummary._lastRun === key) return;
      scheduleDailyWhatsAppSummary._lastRun = key;
      await sendDailyReadySummaries();
    }
  };
  setInterval(tick, 60 * 1000);
  console.log(`[whatsapp] daily summary scheduled around ${hour}:00`);
}

module.exports = {
  sendWhatsAppText,
  notifyDoctorCaseStatus,
  sendDailyReadySummaries,
  scheduleDailyWhatsAppSummary,
  providerConfigured,
};
