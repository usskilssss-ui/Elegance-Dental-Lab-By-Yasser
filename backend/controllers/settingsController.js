const AppSettings = require('../models/AppSettings');
const {
  sendWhatsAppText,
  sendDailyReadySummaries,
  reloadWhatsAppConfig,
  providerConfigured,
} = require('../services/whatsappService');

async function getOrCreateSettings() {
  let doc = await AppSettings.findOne({ key: 'app' });
  if (!doc) {
    doc = await AppSettings.create({ key: 'app' });
  }
  return doc;
}

exports.getWhatsAppSettings = async (req, res) => {
  try {
    const doc = await getOrCreateSettings();
    const wa = doc.whatsapp || {};
    return res.json({
      success: true,
      settings: {
        enabled: !!wa.enabled,
        provider: wa.provider || 'ultramsg',
        instanceId: wa.instanceId || '',
        phoneNumberId: wa.phoneNumberId || '',
        dailyHour: wa.dailyHour ?? 18,
        labName: wa.labName || 'Elegance Dental Lab',
        msgCompleted:
          wa.msgCompleted ||
          '{lab}\nالحالة {caseNumber} للمريض {patient} أصبحت منتهية وجاهزة.',
        msgExited:
          wa.msgExited ||
          '{lab}\nالحالة {caseNumber} للمريض {patient} تم تسليمها/خرجت من المعمل.',
        msgDaily:
          wa.msgDaily ||
          '{lab} — ملخص يومي\nعندك {count} حالات جاهزة للاستلام.\n{list}',
        // never send full token — only whether set
        hasToken: !!(wa.token && String(wa.token).trim()),
        liveConfigured: providerConfigured(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateWhatsAppSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const doc = await getOrCreateSettings();
    const wa = doc.whatsapp || {};

    if (typeof body.enabled === 'boolean') wa.enabled = body.enabled;
    if (body.provider !== undefined) wa.provider = String(body.provider || '');
    if (body.instanceId !== undefined) wa.instanceId = String(body.instanceId || '').trim();
    if (body.phoneNumberId !== undefined) wa.phoneNumberId = String(body.phoneNumberId || '').trim();
    if (body.dailyHour !== undefined) {
      const h = Number(body.dailyHour);
      wa.dailyHour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 18;
    }
    if (body.labName !== undefined) wa.labName = String(body.labName || '').trim() || 'Elegance Dental Lab';
    if (body.msgCompleted !== undefined) {
      wa.msgCompleted = String(body.msgCompleted || '').trim() || wa.msgCompleted;
    }
    if (body.msgExited !== undefined) {
      wa.msgExited = String(body.msgExited || '').trim() || wa.msgExited;
    }
    if (body.msgDaily !== undefined) {
      wa.msgDaily = String(body.msgDaily || '').trim() || wa.msgDaily;
    }
    // Only update token if non-empty string sent (keep existing otherwise)
    if (typeof body.token === 'string' && body.token.trim()) {
      wa.token = body.token.trim();
    }
    if (body.clearToken === true) {
      wa.token = '';
    }

    doc.whatsapp = wa;
    await doc.save();
    await reloadWhatsAppConfig();

    return res.json({
      success: true,
      message: 'تم حفظ إعدادات واتساب',
      liveConfigured: providerConfigured(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.testWhatsApp = async (req, res) => {
  try {
    await reloadWhatsAppConfig();
    if (!providerConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'واتساب مش مضبوط — عبّي Instance + Token وفعّل الإرسال',
      });
    }
    const phone = String(req.body?.phone || req.user?.phone || '').trim();
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'اكتب رقم موبايل للاختبار (مثال: 01xxxxxxxxx)',
      });
    }
    const result = await sendWhatsAppText(
      phone,
      'Elegance Dental Lab\n✅ تجربة إشعار واتساب من السيستم — لو وصلك الرسالة يبقى الإعداد تمام.'
    );
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.error || 'فشل إرسال رسالة الاختبار',
      });
    }
    return res.json({ success: true, message: 'تم إرسال رسالة الاختبار' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.runDailySummaryNow = async (req, res) => {
  try {
    await reloadWhatsAppConfig();
    if (!providerConfigured()) {
      return res.status(400).json({ success: false, message: 'واتساب مش مضبوط' });
    }
    await sendDailyReadySummaries();
    return res.json({ success: true, message: 'تم إرسال الملخص اليومي للدكاترة اللي عندهم حالات جاهزة' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
