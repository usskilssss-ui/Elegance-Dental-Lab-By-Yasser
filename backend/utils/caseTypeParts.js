/**
 * Per-part New / Redo / Modification encoding inside caseType strings.
 * Example: "Emax (3) + Redo - Zircon (2)"
 * Legacy whole-case "Redo - Emax (3) + Zircon (2)" expands so every part is Redo.
 */

function parsePartKind(part) {
  const t = String(part || '').trim();
  if (/^Modification\s*-/i.test(t)) {
    return { kind: 'Modification', bare: t.replace(/^Modification\s*-\s*/i, '').trim() };
  }
  if (/^(Redo|Remake)\s*-/i.test(t)) {
    return { kind: 'Redo', bare: t.replace(/^(Redo|Remake)\s*-\s*/i, '').trim() };
  }
  return { kind: 'New', bare: t };
}

function formatPartWithKind(bare, kind) {
  const b = String(bare || '').trim();
  if (!b) {
    if (kind === 'Modification') return 'Modification';
    if (kind === 'Redo') return 'Redo';
    return '';
  }
  if (kind === 'Modification') return `Modification - ${b}`;
  if (kind === 'Redo') return `Redo - ${b}`;
  return b;
}

function normalizeCaseTypeParts(caseType) {
  let raw = String(caseType || '').trim();
  if (!raw) return raw;
  if (/^(Empty|غير معروف|Unknown)$/i.test(raw)) return raw;
  if (/^(New|Redo|Remake|Modification)$/i.test(raw)) {
    return /^Remake$/i.test(raw) ? 'Redo' : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }

  let leading = null;
  if (/^Modification\s*-/i.test(raw)) {
    leading = 'Modification';
    raw = raw.replace(/^Modification\s*-\s*/i, '');
  } else if (/^(Redo|Remake)\s*-/i.test(raw)) {
    leading = 'Redo';
    raw = raw.replace(/^(Redo|Remake)\s*-\s*/i, '');
  }

  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return leading || '';

  const parsed = parts.map(parsePartKind);

  if (leading) {
    const anyNonNew = parsed.some((p) => p.kind !== 'New');
    if (!anyNonNew) {
      return parsed.map((p) => formatPartWithKind(p.bare, leading)).join(' + ');
    }
    if (parsed[0].kind === 'New') {
      parsed[0] = { kind: leading, bare: parsed[0].bare };
    }
  }

  return parsed.map((p) => formatPartWithKind(p.bare, p.kind)).join(' + ');
}

function splitNormalizedCaseTypeParts(caseType) {
  const normalized = normalizeCaseTypeParts(caseType);
  if (!normalized) return [];
  if (/^(Empty|Redo|Modification|غير معروف|Unknown)$/i.test(normalized)) {
    return [normalized];
  }
  return normalized
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
}

function isExcludedWorkPart(part) {
  const lower = String(part || '').toLowerCase().trim();
  if (!lower) return true;
  if (
    lower === 'empty' ||
    lower === 'غير معروف' ||
    lower === 'unknown' ||
    lower === 'redo' ||
    lower === 'remake' ||
    lower === 'modification'
  ) {
    return true;
  }
  const { kind } = parsePartKind(part);
  if (kind === 'Redo' || kind === 'Modification') return true;
  if (lower.includes('تعديل') || lower.includes('اعاده') || lower.includes('إعادة')) {
    return true;
  }
  return false;
}

function isWholeCaseExcluded(caseType) {
  const ct = String(caseType || '').trim();
  if (!ct) return true;
  const lower = ct.toLowerCase();
  if (
    lower === 'empty' ||
    lower === 'غير معروف' ||
    lower === 'unknown' ||
    lower === 'redo' ||
    lower === 'remake' ||
    lower === 'modification'
  ) {
    return true;
  }
  if (
    (lower.includes('empty') || lower.includes('غير معروف') || lower.includes('unknown')) &&
    !ct.includes('+') &&
    !/\([0-9]+\)/.test(ct) &&
    !/(zircon|emax|pmma|peek|titanium|night|wax|ring|mokup|mockup|try\s*in)/i.test(ct)
  ) {
    return true;
  }

  const parts = splitNormalizedCaseTypeParts(ct);
  if (!parts.length) return true;
  return parts.every(isExcludedWorkPart);
}

module.exports = {
  parsePartKind,
  formatPartWithKind,
  normalizeCaseTypeParts,
  splitNormalizedCaseTypeParts,
  isExcludedWorkPart,
  isWholeCaseExcluded,
};
