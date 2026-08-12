/**
 * Minimal Code128-B encoder → SVG path for case-number barcodes.
 * Encodes printable ASCII (CASE-YYYY-NNNNN) matching print-agent Code128 labels.
 */

/** Width patterns for code values 0–106 (Stop is last). */
const PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

function codeValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 127) {
    throw new Error(`Code128-B cannot encode char code ${code}`);
  }
  return code - 32;
}

export function encodeCode128B(text: string): number[] {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const values = [START_B];
  for (const ch of raw) {
    values.push(codeValue(ch));
  }

  let checksum = START_B;
  for (let i = 1; i < values.length; i++) {
    checksum += values[i]! * i;
  }
  values.push(checksum % 103);
  values.push(STOP);

  const widths: number[] = [];
  for (const v of values) {
    const pattern = PATTERNS[v];
    if (!pattern) continue;
    for (const digit of pattern) {
      widths.push(Number(digit));
    }
  }
  return widths;
}

export function code128SvgPath(
  text: string,
  barHeight = 44,
  moduleWidth = 1.6
): { path: string; width: number; height: number } | null {
  let widths: number[];
  try {
    widths = encodeCode128B(text);
  } catch {
    return null;
  }
  if (!widths.length) return null;

  let x = 0;
  const parts: string[] = [];
  let bar = true;
  for (const w of widths) {
    const px = w * moduleWidth;
    if (bar) {
      parts.push(`M${x},0h${px}v${barHeight}h${-px}z`);
    }
    x += px;
    bar = !bar;
  }

  return {
    path: parts.join(''),
    width: Math.ceil(x),
    height: barHeight,
  };
}
