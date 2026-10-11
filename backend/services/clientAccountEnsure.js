// railway-deploy-stamp: 2026-09-24 lab-convert (no behavior change)
const User = require('../models/User');
const DentalCase = require('../models/DentalCase');
const { normalizeDoctorKey } = require('./casePricingService');
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
  const next = { ...meta, ...extra, requesterType, clientKind: requesterType };
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

function namesAreExact(a, b) {
  const ka = normalizeDoctorKey(a);
  const kb = normalizeDoctorKey(b);
  return !!ka && ka === kb;
}

function caseMatchesClientName(dentalCase, name) {
  const wanted = String(name || '').trim();
  if (!wanted) return false;
  return caseNamesFromDoc(dentalCase).some((value) => namesAreExact(value, wanted));
}

function notesRequesterType(notes) {
  const meta = parseMetaLenient(notes || '');
  const value = String(meta.requesterType || meta.clientKind || '').trim().toLowerCase();
  return value === 'student' || value === 'lab' ? value : '';
}

function applyRequesterTypeFromNotes(doc) {
  if (!doc) return doc;
  const fromNotes = notesRequesterType(doc.notes);
  if (!fromNotes) return doc;
  if (doc.toObject) {
    const plain = doc.toObject();
    return { ...plain, requesterType: fromNotes };
  }
  return { ...doc, requesterType: fromNotes };
}

async function persistRequesterType(id, requesterType, notes, referringDoctor, referringDoctorId) {
  const _id = id && id._id ? id._id : id;
  const $notes = { notes };
  if (referringDoctor) $notes.referringDoctor = referringDoctor;
  if (referringDoctorId) $notes.referringDoctorId = referringDoctorId;
  if (requesterType === 'lab') $notes.priority = 'normal';
  // Notes first via the native driver so a rejected requesterType=lab field
  // cannot roll back the only copy the UI can read after refresh.
  await DentalCase.collection.updateOne({ _id }, { $set: $notes });
  try {
    await DentalCase.collection.updateOne({ _id }, { $set: { requesterType } });
  } catch (err) {
    console.error('[retagCasesForClientName] field', err?.message || err);
  }
  return true;
}

async function retagCasesForClientName(fullName, role, extraIds = [], userId = null) {
  const name = String(fullName || '').trim();
  const requesterType = requesterTypeForRole(role);
  if (!name && !extraIds.length) return 0;

  const exactName = name ? new RegExp(`^${escapeRegex(name)}$`, 'i') : null;
  const notesDoctor = name
    ? new RegExp(`"doctor"\\s*:\\s*"${escapeRegex(name)}"`, 'i')
    : null;
  const idList = (Array.isArray(extraIds) ? extraIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  const [byName, byEmptyField, byId] = await Promise.all([
    exactName
      ? DentalCase.find({ referringDoctor: exactName }).limit(5000)
      : Promise.resolve([]),
    notesDoctor
      ? DentalCase.find({
          $or: [{ referringDoctor: '' }, { referringDoctor: null }, { referringDoctor: { $exists: false } }],
          notes: notesDoctor,
        }).limit(2000)
      : Promise.resolve([]),
    idList.length ? DentalCase.find({ _id: { $in: idList } }) : Promise.resolve([]),
  ]);

  const seen = new Map();
  for (const dentalCase of [...byId, ...byName, ...byEmptyField]) {
    seen.set(String(dentalCase._id), dentalCase);
  }

  if (idList.length) {
    try {
      await DentalCase.updateMany(
        { _id: { $in: idList } },
        { $set: { requesterType } }
      );
    } catch (err) {
      console.error('[retagCasesForClientName] updateMany', err?.message || err);
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
    const alreadyPersisted =
      dentalCase.requesterType === requesterType &&
      notesRequesterType(notesText) === requesterType;
    const linked =
      !userId || String(dentalCase.referringDoctorId || '') === String(userId);
    if (alreadyPersisted && notesText === nextNotes && linked) {
      updated += 1;
      continue;
    }
    if (alreadyPersisted && notesText === nextNotes && userId) {
      await DentalCase.collection.updateOne(
        { _id: dentalCase._id },
        { $set: { referringDoctorId: userId } }
      );
      updated += 1;
      continue;
    }
    const ok = await persistRequesterType(
      dentalCase._id,
      requesterType,
      nextNotes,
      displayName,
      userId
    );
    if (ok) updated += 1;
  }
  return updated;
}

async function findClientUsersByName(name) {
  const clients = await User.find({
    role: { $in: CLIENT_PORTAL_ROLES },
    isActive: { $ne: false },
  }).limit(4000);
  const matches = clients.filter((user) => namesAreExact(user.fullName, name));
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
    const updatedCases = shouldRetag
      ? await retagCasesForClientName(sameRole.fullName, role, [], sameRole._id)
      : 0;
    return { action: updatedCases ? 'retagged' : 'exists', user: sameRole, updatedCases };
  }

  const otherRole = matches.find((user) => user.role !== role);
  if (otherRole) {
    // Creating/editing a case must not flip an already-converted lab/student account back to doctor.
    if (!shouldRetag) {
      return { action: 'exists', user: otherRole, updatedCases: 0 };
    }
    try {
      otherRole.role = role;
      otherRole.department = departmentForClientRole(role);
      await otherRole.save();
    } catch (err) {
      await User.updateOne(
        { _id: otherRole._id },
        { $set: { role, department: departmentForClientRole(role) } }
      );
    }
    const updatedCases = await retagCasesForClientName(otherRole.fullName, role, [], otherRole._id);
    return { action: 'converted', user: otherRole, updatedCases };
  }

  const created = await createClientAccount(name, role);
  const updatedCases = shouldRetag ? await retagCasesForClientName(name, role, [], created._id) : 0;
  return { action: 'created', user: created, updatedCases };
}

module.exports = {
  DEFAULT_PASSWORD,
  ensureClientAccount,
  retagCasesForClientName,
  setRequesterTypeInNotes,
  persistRequesterType,
  applyRequesterTypeFromNotes,
};
