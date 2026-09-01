const Material = require('../models/Material');
const { ensureDefaultMaterials } = require('../services/labConfigService');
const { invalidateMaterialCache } = require('../services/casePricingService');

function sanitizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\u0600-\u06ff]/gi, '')
    .slice(0, 64);
}

function parseKeywords(input) {
  if (Array.isArray(input)) {
    return input.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean);
  }
  return String(input || '')
    .split(/[,|\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

exports.listMaterials = async (req, res) => {
  try {
    await ensureDefaultMaterials();
    const activeOnly = String(req.query.active || '') === '1' || req.query.active === 'true';
    const q = activeOnly ? { active: true } : {};
    const materials = await Material.find(q).sort({ sortOrder: 1, label: 1 }).lean();
    return res.json({ success: true, materials });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createMaterial = async (req, res) => {
  try {
    const body = req.body || {};
    const key = sanitizeKey(body.key || body.label);
    if (!key) {
      return res.status(400).json({ success: false, message: 'مفتاح الماتريال مطلوب' });
    }
    const label = String(body.label || '').trim();
    if (!label) {
      return res.status(400).json({ success: false, message: 'اسم الماتريال مطلوب' });
    }
    const exists = await Material.findOne({ key });
    if (exists) {
      return res.status(400).json({ success: false, message: 'الماتريال موجود بالفعل' });
    }
    const keywords = parseKeywords(body.matchKeywords);
    if (!keywords.length) keywords.push(label.toLowerCase());

    const doc = await Material.create({
      key,
      label,
      labelAr: String(body.labelAr || '').trim(),
      matchKeywords: keywords,
      defaultPrice: Math.max(0, Number(body.defaultPrice) || 0),
      active: body.active !== false,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      showInWorkTypes: body.showInWorkTypes !== false,
      showInCounters: body.showInCounters !== false,
      color: String(body.color || '#64748b').trim() || '#64748b',
    });
    invalidateMaterialCache();
    return res.status(201).json({ success: true, material: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateMaterial = async (req, res) => {
  try {
    const doc = await Material.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'الماتريال غير موجود' });
    }
    const body = req.body || {};
    if (body.label !== undefined) {
      const label = String(body.label || '').trim();
      if (!label) {
        return res.status(400).json({ success: false, message: 'اسم الماتريال مطلوب' });
      }
      doc.label = label;
    }
    if (body.labelAr !== undefined) doc.labelAr = String(body.labelAr || '').trim();
    if (body.matchKeywords !== undefined) {
      const keywords = parseKeywords(body.matchKeywords);
      if (!keywords.length) {
        return res.status(400).json({ success: false, message: 'كلمات المطابقة مطلوبة' });
      }
      doc.matchKeywords = keywords;
    }
    if (body.defaultPrice !== undefined) {
      doc.defaultPrice = Math.max(0, Number(body.defaultPrice) || 0);
    }
    if (typeof body.active === 'boolean') doc.active = body.active;
    if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
      doc.sortOrder = Number(body.sortOrder);
    }
    if (typeof body.showInWorkTypes === 'boolean') doc.showInWorkTypes = body.showInWorkTypes;
    if (typeof body.showInCounters === 'boolean') doc.showInCounters = body.showInCounters;
    if (body.color !== undefined) {
      doc.color = String(body.color || '#64748b').trim() || '#64748b';
    }
    await doc.save();
    invalidateMaterialCache();
    return res.json({ success: true, material: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMaterial = async (req, res) => {
  try {
    const doc = await Material.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'الماتريال غير موجود' });
    }
    invalidateMaterialCache();
    return res.json({ success: true, message: 'تم حذف الماتريال' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
