const User = require('../models/User');
const DentalCase = require('../models/DentalCase');
const { doctorKeysMatch, normalizeDoctorKey } = require('./casePricingService');
const {
  CLIENT_PORTAL_ROLES,
  departmentForClientRole,
  normalizeClientRole,
  requesterTypeForRole,
} = require('../utils/clientRoles');

const DEFAULT_PASSWORD = '123456';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parseMetaLenient(notes) {
  if (!notes || typeof notes !== 'string') return {};
  const normalized = notes.replace(/^\uFEFF/, '');
  if (normalized.startsWith('__META__')) {
    return parseJsonObject(normalized.slice('__META__'.length).replace(/^\r?\n/, '')) || {};
  }
  return parseJsonObject(normalized) || {};
}

function setRequesterTypeInNotes(notes, requesterType, extra = {}) {
  const prefix = '__META__\n';
  const raw = String(notes || '');
  const normalized = raw.replace(/^\uFEFF/, '');
  const hasMetaPrefix = normalized.startsWith('__META__');
  const meta = parseMetaLenient(raw);
  const next = { ...meta, ...extra, requesterType };
  const encoded = `${prefix}${JSON.stringify(next)}`;
  if (!hasMetaPrefix && raw.trim() && !parseJsonObject(normalized)) {
    return `${encoded}\n${raw}`;
  }
  return encoded;
}

function caseNameFromDoc(dentalCase) {
  const meta = parseMetaLenient(dentalCase.notes || '');
  return String(dentalCase.referringDoctor || meta.doctor || meta.doctorName || '').trim();
}

async function retagCasesForClientName(fullName, role) {
  const name = String(fullName || '').trim();
  const requesterType = requesterTypeForRole(role);
  if (!name) return 0;

  const looseRe = new RegExp(escapeRegex(name), 'i');
  let candidates = await DentalCase.find({
    $or: [{ referringDoctor: looseRe }, { notes: looseRe }],
  }).limit(8000);

  if (!candidates.length) {
    candidates = await DentalCase.find({ notes: /__META__/ }).limit(8000);
  }

  let updated = 0;
  for (const dentalCase of candidates) {
    const caseName = caseNameFromDoc(dentalCase);
    const notesText = String(dentalCase.notes || '');
    const matched =
      (caseName && doctorKeysMatch(caseName, name)) ||
      (!caseName && looseRe.test(notesText));
    if (!matched) continue;

    const nextNotes = setRequesterTypeInNotes(notesText, requesterType, {
      doctor: caseName || name,
    });
    const changed =
      dentalCase.requesterType !== requesterType || notesText !== nextNotes;
    if (!changed) continue;
    dentalCase.requesterType = requesterType;
    dentalCase.notes = nextNotes;
    if (!dentalCase.referringDoctor) {
      dentalCase.referringDoctor = caseName || name;
    }
    await dentalCase.save();
    updated += 1;
  }
  return updated;
}

async function findClientUsersByName(name) {
  const clients = await User.find({
    role: { $in: CLIENT_PORTAL_ROLES },
    isActive: { $ne: false },
  }).limit(4000);
  const matches = clients.filter((user) => doctorKeysMatch(user.fullName, name));
  const wanted = normalizeDoctorKey(name);
  matches.sort((a, b) => {
    const aExact = normalizeDoctorKey(a.fullName) === wanted ? 0 : 1;
    const bExact = normalizeDoctorKey(b.fullName) === wanted ? 0 : 1;
    return aExact - bExact;
  });
  return matches;
}

function emailLocalPart(fullName, role) {
  const ascii = String(fullName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
  const base = ascii || 'client';
  return `${base}.${role}.${Date.now().toString(36)}`.slice(0, 48);
}

async function createClientAccount(fullName, role) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const email = `${emailLocalPart(fullName, role)}${attempt ? attempt : ''}@elegance.com`;
    try {
      const user = new User({
        fullName,
        email,
        phone: '0000000000',
        password: DEFAULT_PASSWORD,
        role,
        department: departmentForClientRole(role),
        isActive: true,
        loginPasswordVisible: DEFAULT_PASSWORD,
      });
      await user.save();
      return user;
    } catch (error) {
      lastError = error;
      if (error?.code !== 11000) throw error;
    }
  }
  throw lastError || new Error('Failed to create client account');
}

/**
 * Find or create a doctor/student/lab account for a form name.
 * If the same name already exists as another client role, convert it and retag cases.
 */
async function ensureClientAccount(fullName, requesterType) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  const role = normalizeClientRole(requesterType);
  if (!name) return { action: 'skipped' };

  const matches = await findClientUsersByName(name);
  const sameRole = matches.find((user) => user.role === role);
  if (sameRole) {
    const updatedCases = await retagCasesForClientName(sameRole.fullName, role);
    return { action: updatedCases ? 'retagged' : 'exists', user: sameRole, updatedCases };
  }

  const otherRole = matches.find((user) => user.role !== role);
  if (otherRole) {
    otherRole.role = role;
    otherRole.department = departmentForClientRole(role);
    await otherRole.save();
    const updatedCases = await retagCasesForClientName(otherRole.fullName, role);
    return { action: 'converted', user: otherRole, updatedCases };
  }

  const created = await createClientAccount(name, role);
  const updatedCases = await retagCasesForClientName(name, role);
  return { action: 'created', user: created, updatedCases };
}

module.exports = {
  DEFAULT_PASSWORD,
  ensureClientAccount,
  retagCasesForClientName,
  setRequesterTypeInNotes,
};
