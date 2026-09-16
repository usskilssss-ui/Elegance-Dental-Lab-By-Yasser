/**
 * Name normalization + matching helpers.
 * Notes meta prefix must match caseController / dental-case-api.mapper.
 */

const NOTES_META_PREFIX = '__META__\n';

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_./\\|+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function namesLooselyEqual(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' ').filter((t) => t.length > 1));
  const tb = new Set(nb.split(' ').filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return false;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  const ratio = hit / Math.min(ta.size, tb.size);
  return ratio >= 0.66 && hit >= 1;
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
  return teeth.map((t) => String(t?.fdi || '').trim()).filter(Boolean);
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
};
