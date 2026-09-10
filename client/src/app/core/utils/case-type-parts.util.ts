/**
 * Per-part New / Redo / Modification encoding inside caseType strings.
 * Example: "Emax (3) + Redo - Zircon (2)"
 * Legacy whole-case "Redo - Emax (3) + Zircon (2)" expands so every part is Redo.
 */

export type WorkPartKind = 'New' | 'Redo' | 'Modification';

const KIND_CYCLE: WorkPartKind[] = ['New', 'Redo', 'Modification'];

export function parsePartKind(part: string): { kind: WorkPartKind; bare: string } {
  const t = String(part || '').trim();
  if (/^Modification\s*-/i.test(t)) {
    return { kind: 'Modification', bare: t.replace(/^Modification\s*-\s*/i, '').trim() };
  }
  if (/^(Redo|Remake)\s*-/i.test(t)) {
    return { kind: 'Redo', bare: t.replace(/^(Redo|Remake)\s*-\s*/i, '').trim() };
  }
  return { kind: 'New', bare: t };
}

export function formatPartWithKind(bare: string, kind: WorkPartKind): string {
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

/** Expand legacy whole-case prefixes so billing can reason per part. */
export function normalizeCaseTypeParts(caseType: string): string {
  let raw = String(caseType || '').trim();
  if (!raw) return raw;
  if (/^(Empty|غير معروف|Unknown)$/i.test(raw)) return raw;
  if (/^(New|Redo|Remake|Modification)$/i.test(raw)) {
    return /^Remake$/i.test(raw) ? 'Redo' : raw.replace(/^./, (c) => c.toUpperCase());
  }

  let leading: WorkPartKind | null = null;
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
      return parsed.map((p) => formatPartWithKind(p.bare, leading!)).join(' + ');
    }
    if (parsed[0].kind === 'New') {
      parsed[0] = { kind: leading, bare: parsed[0].bare };
    }
  }

  return parsed.map((p) => formatPartWithKind(p.bare, p.kind)).join(' + ');
}

export function splitNormalizedCaseTypeParts(caseType: string): string[] {
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

/** Redo / Modification / empty / unknown parts (not try-in — handle separately). */
export function isExcludedWorkPart(part: string): boolean {
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
  if (
    lower.includes('تعديل') ||
    lower.includes('اعاده') ||
    lower.includes('إعادة')
  ) {
    return true;
  }
  return false;
}

/** True when the case has no billable material parts (all redo/mod/empty/unknown). */
export function isWholeCaseExcluded(caseType: string): boolean {
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
  // Bare unknown/empty tokens without materials
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

export function nextWorkPartKind(kind: WorkPartKind): WorkPartKind {
  const i = KIND_CYCLE.indexOf(kind);
  return KIND_CYCLE[(i + 1) % KIND_CYCLE.length];
}

export function inferDropdownCaseType(caseType: string): WorkPartKind | 'Empty' {
  const ct = String(caseType || '').trim();
  if (!ct || /^Empty$/i.test(ct)) return 'Empty';
  const parts = splitNormalizedCaseTypeParts(ct);
  if (!parts.length) return 'New';
  if (parts.every((p) => parsePartKind(p).kind === 'Modification')) return 'Modification';
  if (parts.every((p) => parsePartKind(p).kind === 'Redo')) return 'Redo';
  // Mixed or all-new → New (dropdown is the default for new chips)
  return 'New';
}
