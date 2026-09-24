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

function caseNamesFromDoc(dentalCase) {
  const meta = parseMetaLenient(dentalCase.notes || '');
  return [
    dentalCase.referringDoctor,
    meta.doctor,
    meta.doctorName,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function caseMatchesClientName(dentalCase, name) {
  const wanted = String(name || '').trim();
  if (!wanted) return false;
  if (caseNamesFromDoc(dentalCase).some((value) => doctorKeysMatch(value, wanted))) {
    return true;
  }
  return new RegExp(escapeRegex(wanted), 'i').test(String(dentalCase.notes || ''));
}

async function retagCasesForClientName(fullName, role, extraIds = []) {
  const name = String(fullName || '').trim();
  const requesterType = requesterTypeForRole(role);
  if (!name && !extraIds.length) return 0;

  const looseRe = name ? new RegExp(escapeRegex(name), 'i') : null;
  const idList = (Array.isArray(extraIds) ? extraIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  const [byName, byId] = await Promise.all([
    name
      ? DentalCase.find({
          $or: [{ referringDoctor: looseRe }, { notes: looseRe }],
        }).limit(20000)
      : Promise.resolve([]),
    idList.length ? DentalCase.find({ _id: { $in: idList } }) : Promise.resolve([]),
  ]);

  const seen = new Map();
  for (const dentalCase of [...byId, ...byName]) {
    seen.set(String(dentalCase._id), dentalCase);
  }

  if (idList.length) {
    await DentalCase.updateMany(
      { _id: { $in: idList } },
      { $set: { requesterType } }
    );
  }

  if (!seen.size && name) {
    const fallback = await DentalCase.find({ notes: /__META__/ }).limit(20000);
    for (const dentalCase of fallback) {
      if (caseMatchesClientName(dentalCase, name)) {
        seen.set(String(dentalCase._id), dentalCase);
      }
    }
  }

  let updated = 0;
  for (const dentalCase of seen.values()) {
    const forced = idList.includes(String(dentalCase._id));
    if (!forced && name && !caseMatchesClientName(dentalCase, name)) continue;

    const notesText = String(dentalCase.notes || '');
    const displayName = name || caseNamesFromDoc(dentalCase)[0];
    const nextNotes = setRequesterTypeInNotes(notesText, requesterType, {
      doctor: displayName,
    });
    const changed =
      dentalCase.requesterType !== requesterType ||
      notesText !== nextNotes ||
      (displayName && dentalCase.referringDoctor !== displayName);
    if (!changed) continue;
    try {
      await DentalCase.updateOne(
        { _id: dentalCase._id },
        {
          $set: {
            requesterType,
            notes: nextNotes,
            ...(displayName ? { referringDoctor: displayName } : {}),
          },
        }
      );
      updated += 1;
    } catch (err) {
      console.error('[retagCasesForClientName]', String(dentalCase._id), err?.message || err);
    }
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
async function ensureClientAccount(fullName, requesterType, opts = {}) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  const role = normalizeClientRole(requesterType);
  const shouldRetag = opts.retag !== false;
  if (!name) return { action: 'skipped' };

  const matches = await findClientUsersByName(name);
  const sameRole = matches.find((user) => user.role === role);
  if (sameRole) {
    const updatedCases = shouldRetag ? await retagCasesForClientName(sameRole.fullName, role) : 0;
    return { action: updatedCases ? 'retagged' : 'exists', user: sameRole, updatedCases };
  }

  const otherRole = matches.find((user) => user.role !== role);
  if (otherRole) {
    // Creating/editing a case must not flip an already-converted lab/student account back to doctor.
    if (!shouldRetag) {
      return { action: 'exists', user: otherRole, updatedCases: 0 };
    }
    otherRole.role = role;
    otherRole.department = departmentForClientRole(role);
    await otherRole.save();
    const updatedCases = await retagCasesForClientName(otherRole.fullName, role);
    return { action: 'converted', user: otherRole, updatedCases };
  }

  const created = await createClientAccount(name, role);
  const updatedCases = shouldRetag ? await retagCasesForClientName(name, role) : 0;
  return { action: 'created', user: created, updatedCases };
}

module.exports = {
  DEFAULT_PASSWORD,
  ensureClientAccount,
  retagCasesForClientName,
  setRequesterTypeInNotes,
};
