/**
 * Name normalization + AR↔EN matching for Exocad sync.
 * Notes meta prefix must match caseController.
 */

const NOTES_META_PREFIX = '__META__\n';

/** Common Egyptian dental-lab name aliases (Arabic ↔ Latin). */
const NAME_ALIASES = {
  احمد: ['ahmed', 'ahmad'],
  محمد: ['mohamed', 'mohammed', 'muhammad', 'moahmed'],
  محمود: ['mahmoud', 'mahmood'],
  علي: ['ali', 'aly'],
  خالد: ['khaled', 'khalid'],
  حسن: ['hassan', 'hasan', 'hasaan'],
  حسين: ['hussein', 'hussain'],
  ابراهيم: ['ibrahim', 'ebrahim', 'ibrahem'],
  عبداللة: ['abdallah', 'abdalah', 'abdullah'],
  عبدالله: ['abdallah', 'abdalah', 'abdullah'],
  يوسف: ['youssef', 'yousef', 'yusuf'],
  سعيد: ['saeed', 'said', 'sayed'],
  سامح: ['sameh'],
  سامر: ['samer', 'samier'],
  عمر: ['omar', 'omer'],
  عثمان: ['othman', 'osman'],
  اسامة: ['osama', 'usama'],
  عماد: ['emad', 'imad'],
  عيد: ['eid'],
  الجندي: ['aljendy', 'elgendy', 'elgindy', 'jendy', 'gendy', 'aljendy'],
  جندي: ['aljendy', 'elgendy', 'jendy', 'gendy'],
  فرغلي: ['farghly', 'farghaly'],
  الاهرام: ['alharam', 'al ahram'],
};

// Reverse Latin → Arabic keys for lookup
const LATIN_TO_KEYS = {};
for (const [ar, list] of Object.entries(NAME_ALIASES)) {
  for (const lat of list) {
    LATIN_TO_KEYS[lat] = ar;
  }
  LATIN_TO_KEYS[ar] = ar;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ط/g, 'ط')
    .replace(/\bdr\b\.?/gi, ' ')
    .replace(/\bdoctor\b/gi, ' ')
    .replace(/\bdentist\b/gi, ' ')
    .replace(/[_./\\|+\-,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Expand one token into equivalent Arabic + Latin forms. */
function expandToken(token) {
  const t = normalizeName(token);
  if (!t || t.length < 2) return new Set();
  const out = new Set([t]);
  const key = LATIN_TO_KEYS[t] || (NAME_ALIASES[t] ? t : null);
  if (key && NAME_ALIASES[key]) {
    out.add(key);
    for (const a of NAME_ALIASES[key]) out.add(normalizeName(a));
  }
  // Contains alias as substring (e.g. mohamed_aljendy)
  for (const [ar, list] of Object.entries(NAME_ALIASES)) {
    if (t.includes(ar) || list.some((x) => t.includes(x))) {
      out.add(ar);
      for (const a of list) out.add(normalizeName(a));
    }
  }
  return out;
}

function tokenSetsMatch(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return false;
  let hit = 0;
  for (const at of aTokens) {
    const ea = expandToken(at);
    for (const bt of bTokens) {
      const eb = expandToken(bt);
      let overlap = false;
      for (const x of ea) {
        if (eb.has(x)) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        hit += 1;
        break;
      }
    }
  }
  const ratio = hit / Math.min(aTokens.length, bTokens.length);
  return ratio >= 0.66 && hit >= 1;
}

function namesLooselyEqual(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = na.split(' ').filter((t) => t.length > 1);
  const tb = nb.split(' ').filter((t) => t.length > 1);
  if (tokenSetsMatch(ta, tb)) return true;

  // Fold full strings through alias expansion (الجندي vs DR/MOHAMED_ALJENDY)
  const ea = new Set();
  const eb = new Set();
  for (const t of ta) for (const x of expandToken(t)) ea.add(x);
  for (const t of tb) for (const x of expandToken(t)) eb.add(x);
  let shared = 0;
  for (const x of ea) if (eb.has(x)) shared += 1;
  // Doctor nicknames: one strong shared meaningful alias is enough if both sides have it
  const strong = ['aljendy', 'elgendy', 'jendy', 'gendy', 'الجندي', 'جندي'];
  if (strong.some((s) => ea.has(s) && eb.has(s))) return true;
  return shared >= 2;
}

function parseNotesMeta(notes) {
  if (!notes || typeof notes !== 'string' || !notes.startsWith(NOTES_META_PREFIX)) return {};
  try {
    return JSON.parse(notes.slice(NOTES_META_PREFIX.length));
  } catch {
    return {};
  }
}

function requestedUnitsFromCase(doc) {
  const meta = parseNotesMeta(doc.notes || '');
  const q = Number(meta.quantity ?? meta.qty);
  if (Number.isFinite(q) && q > 0) return q;
  const fromType = String(doc.caseType || '').match(/\((\d+)\)/);
  if (fromType) return parseInt(fromType[1], 10) || 0;
  return 0;
}

function requestedTeethFromCase(doc) {
  const meta = parseNotesMeta(doc.notes || '');
  const teeth = Array.isArray(meta.teeth) ? meta.teeth : [];
  return teeth
    .map((t) => String(t?.fdi || t?.fdi || '').trim())
    .filter(Boolean);
}

function isExitedCase(doc) {
  return String(doc.currentStage || '') === 'exited' || String(doc.status || '') === 'exited';
}

module.exports = {
  NOTES_META_PREFIX,
  normalizeName,
  namesLooselyEqual,
  parseNotesMeta,
  requestedUnitsFromCase,
  requestedTeethFromCase,
  isExitedCase,
  expandToken,
};
