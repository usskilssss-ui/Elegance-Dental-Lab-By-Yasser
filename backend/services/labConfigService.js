const Material = require('../models/Material');
const AppSettings = require('../models/AppSettings');
const DEFAULT_MATERIALS = require('../data/defaultMaterials');

async function ensureDefaultMaterials() {
  const count = await Material.countDocuments();
  if (count > 0) return { created: 0 };
  await Material.insertMany(
    DEFAULT_MATERIALS.map((m) => ({
      ...m,
      active: true,
      showInWorkTypes: m.showInWorkTypes !== false,
      showInCounters: m.showInCounters !== false,
    }))
  );
  return { created: DEFAULT_MATERIALS.length };
}

async function getOrCreateLabSettings() {
  let doc = await AppSettings.findOne({ key: 'app' });
  if (!doc) {
    doc = await AppSettings.create({ key: 'app' });
  }
  // Backfill branding from whatsapp.labName if empty
  if (!doc.branding) doc.branding = {};
  if (!doc.branding.labName && doc.whatsapp?.labName) {
    doc.branding.labName = doc.whatsapp.labName;
  }
  if (!doc.workflow) {
    doc.workflow = {
      enabledStages: AppSettings.ALL_STAGES || [
        'waiting',
        'secretary',
        'design',
        'khart',
        'finishing',
        'completed',
        'exited',
      ],
      allowSkipSecretary: true,
      allowSkipKhart: true,
    };
  }
  return doc;
}

async function buildDefaultPricesFromMaterials() {
  const mats = await Material.find({ active: true }).lean();
  const prices = {};
  for (const m of mats) {
    prices[m.key] = Number(m.defaultPrice) || 0;
  }
  return prices;
}

module.exports = {
  ensureDefaultMaterials,
  getOrCreateLabSettings,
  buildDefaultPricesFromMaterials,
};
