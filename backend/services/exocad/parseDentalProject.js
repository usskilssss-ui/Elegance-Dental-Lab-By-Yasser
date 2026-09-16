/**
 * Pure helpers for Exocad .dentalProject XML (no I/O).
 * WorkParams blob is encrypted — ignore it; use clear XML tags only.
 */

const crypto = require('crypto');

const NON_DESIGN_TYPES = new Set(
  [
    'healthytooth',
    'antagonist',
    'intacttooth',
    'missingtooth',
    'removedtooth',
    'extractedtooth',
    'scanbody',
    'gingiva',
    'dummy',
  ].map((s) => s.toLowerCase())
);

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function tagValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = String(xml).match(re);
  return m ? String(m[1] || '').trim() : '';
}

function extractTeeth(xml) {
  const teeth = [];
  const re =
    /<Tooth>\s*<Number>\s*(\d+)\s*<\/Number>\s*<ReconstructionType>\s*([^<]+)\s*<\/ReconstructionType>/gi;
  let m;
  while ((m = re.exec(xml))) {
    teeth.push({
      number: String(m[1]).trim(),
      reconstructionType: String(m[2]).trim(),
    });
  }
  return teeth;
}

function isDesignedTooth(reconstructionType) {
  const t = String(reconstructionType || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!t) return false;
  if (NON_DESIGN_TYPES.has(t)) return false;
  return true;
}

/**
 * @param {string} xmlContent
 * @param {{ sourceFile?: string, projectFolder?: string }} [meta]
 */
function parseDentalProjectXml(xmlContent, meta = {}) {
  const xml = stripBom(xmlContent);
  if (!xml.includes('<Treatment') && !xml.includes('<Tooth')) {
    throw new Error('Invalid Exocad dentalProject XML');
  }

  const practiceName = tagValue(xml, 'PracticeName');
  const practiceId = tagValue(xml, 'PracticeId');
  const patientFirst = tagValue(xml, 'PatientFirstName');
  const patientLast = tagValue(xml, 'PatientName');
  const patientId = tagValue(xml, 'PatientId');
  const patientName = [patientFirst, patientLast].filter(Boolean).join(' ').trim();
  const dateTimeRaw = tagValue(xml, 'DateTime');
  const projectDateTime = dateTimeRaw ? new Date(dateTimeRaw) : null;

  const allTeeth = extractTeeth(xml);
  const designed = allTeeth.filter((t) => isDesignedTooth(t.reconstructionType));
  const designedTeeth = [...new Set(designed.map((t) => t.number))].sort(
    (a, b) => Number(a) - Number(b)
  );
  const reconstructionTypes = [...new Set(designed.map((t) => t.reconstructionType))];

  const sourceFile = String(meta.sourceFile || '').trim();
  const projectFolder = String(meta.projectFolder || '').trim();
  const folderHint = projectFolder.split(/[/\\]/).filter(Boolean).pop() || '';

  const stableKey = [
    practiceId || practiceName,
    patientId || patientName,
    dateTimeRaw || '',
    folderHint,
    sourceFile.split(/[/\\]/).pop() || '',
  ]
    .join('|')
    .toLowerCase();

  const exocadCaseId = crypto.createHash('sha1').update(stableKey).digest('hex');

  return {
    exocadCaseId,
    practiceName,
    practiceId,
    patientName,
    patientId,
    designedTeeth,
    designedUnits: designedTeeth.length,
    reconstructionTypes,
    rawToothCount: allTeeth.length,
    projectDateTime:
      projectDateTime && !Number.isNaN(projectDateTime.getTime()) ? projectDateTime : null,
    sourceFile: sourceFile.split(/[/\\]/).pop() || sourceFile,
    projectFolder: folderHint,
  };
}

module.exports = {
  parseDentalProjectXml,
  isDesignedTooth,
  NON_DESIGN_TYPES,
};
