/**
 * Same doctor/lab name rule as the server (backend/utils/doctorName.js):
 * titles, spacing, punctuation and Arabic letter variants are ignored.
 */
const TITLE_RE = /^(?:د\s*[./]|د(?=\s)|dr\s*[./]|dr(?=\s)|doctor(?=\s)|دكتور[ةه]?(?=\s)|أ\s*\.|ا\s*\.)\s*/i;

export function normalizeDoctorKey(name: string | null | undefined): string {
  let s = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TITLE_RE, '');
    if (next === s) break;
    s = next.trim();
  }
  s = s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)عبد\s+/g, '$1عبد');
  return s;
}

export function sameDoctorName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = normalizeDoctorKey(a);
  return Boolean(ka) && ka === normalizeDoctorKey(b);
}
