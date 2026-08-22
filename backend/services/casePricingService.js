/**
 * Shared case pricing helpers — mirrors admin calculateCaseCost / isExcludedWorkCaseType.
 */

const DEFAULT_PRICES = {
  emax: 1000,
  germanZircon: 850,
  zircon: 700,
  titanium: 2200,
  peek: 1700,
  pmma: 250,
  nightGuard: 300,
  mockup: 250,
  wax: 0,
  ring: 0,
  tryIn: 0,
};

/** Normalize doctor name for matching (titles stripped, like WhatsApp normalizeDoctorKey). */
function normalizeDoctorKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^(د\.|د|dr\.|dr|doctor|أ\.|ا\.)\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function doctorKeysMatch(a, b) {
  const ka = normalizeDoctorKey(a);
  const kb = normalizeDoctorKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

function isExcludedWorkCaseType(caseType) {
  const ct = String(caseType || '').toLowerCase();
  return (
    ct.includes('redo') ||
    ct.includes('remake') ||
    ct.includes('modification') ||
    ct.includes('تعديل') ||
    ct.includes('اعاده') ||
    ct.includes('إعادة') ||
    ct.includes('empty') ||
    ct.includes('غير معروف') ||
    ct.includes('unknown')
  );
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

function resolvePrices(custom) {
  return {
    emax: custom?.emax ?? DEFAULT_PRICES.emax,
    germanZircon: custom?.germanZircon ?? DEFAULT_PRICES.germanZircon,
    zircon: custom?.zircon ?? DEFAULT_PRICES.zircon,
    titanium: custom?.titanium ?? DEFAULT_PRICES.titanium,
    peek: custom?.peek ?? DEFAULT_PRICES.peek,
    pmma: custom?.pmma ?? DEFAULT_PRICES.pmma,
    nightGuard: custom?.nightGuard ?? DEFAULT_PRICES.nightGuard,
    mockup: custom?.mockup ?? DEFAULT_PRICES.mockup,
    wax: custom?.wax ?? DEFAULT_PRICES.wax,
    ring: custom?.ring ?? DEFAULT_PRICES.ring,
    tryIn: custom?.tryIn ?? DEFAULT_PRICES.tryIn,
  };
}

/**
 * Price a case like admin calculateCaseCost.
 * @param {string} caseType
 * @param {object|string} metaOrNotes — notes meta object or raw notes string
 * @param {object} [customPrices] — DoctorPricing.prices
 */
function calculateCaseCost(caseType, metaOrNotes, customPrices) {
  if (isExcludedWorkCaseType(caseType)) return 0;

  const meta =
    metaOrNotes && typeof metaOrNotes === 'object' && !Array.isArray(metaOrNotes)
      ? metaOrNotes
      : parseNotesMeta(metaOrNotes || '');

  if (meta.isRedoCase || meta.isModificationCase) return 0;

  const prices = resolvePrices(customPrices);
  let total = 0;
  const parts = String(caseType || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const caseOverallQuantity = Number(meta.quantity ?? 1) || 1;

  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    const match = part.match(/\((\d+)\)/);
    const qty = match ? parseInt(match[1], 10) : caseOverallQuantity;

    if (lowerPart.includes('emax')) {
      total += qty * prices.emax;
    } else if (lowerPart.includes('german zircon') || lowerPart.includes('german')) {
      total += qty * prices.germanZircon;
    } else if (lowerPart.includes('zircon')) {
      total += qty * prices.zircon;
    } else if (lowerPart.includes('titanium')) {
      total += qty * prices.titanium;
    } else if (lowerPart.includes('peek')) {
      total += qty * prices.peek;
    } else if (lowerPart.includes('pmma cad') || lowerPart.includes('pmma')) {
      total += qty * prices.pmma;
    } else if (
      lowerPart.includes('night guard') ||
      lowerPart.includes('nightguard') ||
      lowerPart.includes('guard')
    ) {
      total += qty * prices.nightGuard;
    } else if (
      lowerPart.includes('mokup') ||
      lowerPart.includes('mockup') ||
      lowerPart.includes('mock up') ||
      lowerPart.includes('موكب')
    ) {
      total += qty * prices.mockup;
    } else if (lowerPart.includes('wax')) {
      total += qty * prices.wax;
    } else if (lowerPart.includes('ring')) {
      total += qty * prices.ring;
    } else if (lowerPart.includes('try in') || lowerPart.includes('tryin')) {
      total += qty * prices.tryIn;
    }
  }

  return total;
}

function findPricingForDoctor(pricings, doctorName) {
  if (!Array.isArray(pricings) || !doctorName) return null;
  const exact = pricings.find((p) => doctorKeysMatch(p.doctorName, doctorName));
  if (exact) return exact;
  const want = String(doctorName).trim().toLowerCase();
  return (
    pricings.find((p) => String(p.doctorName || '').trim().toLowerCase() === want) || null
  );
}

module.exports = {
  DEFAULT_PRICES,
  normalizeDoctorKey,
  doctorKeysMatch,
  isExcludedWorkCaseType,
  parseNotesMeta,
  resolvePrices,
  calculateCaseCost,
  findPricingForDoctor,
};
