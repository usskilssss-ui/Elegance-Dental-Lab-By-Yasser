const User = require('../models/User');
const DentalCase = require('../models/DentalCase');
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

function nameRegex(fullName) {
  return new RegExp(`^${escapeRegex(String(fullName || '').trim())}$`, 'i');
}

function setRequesterTypeInNotes(notes, requesterType) {
  const prefix = '__META__\n';
  if (!notes || typeof notes !== 'string') {
    return `${prefix}${JSON.stringify({ requesterType })}`;
  }
  const normalized = notes.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('__META__')) return notes;
  const rest = normalized.slice('__META__'.length).replace(/^\r?\n/, '');
  try {
    const meta = JSON.parse(rest) || {};
    meta.requesterType = requesterType;
    return `${prefix}${JSON.stringify(meta)}`;
  } catch {
    return notes;
  }
}

async function retagCasesForClientName(fullName, role) {
  const name = String(fullName || '').trim();
  const requesterType = requesterTypeForRole(role);
  if (!name) return 0;

  const notesRe = new RegExp(`"doctor"\\s*:\\s*"${escapeRegex(name)}"`, 'i');
  const cases = await DentalCase.find({
    $or: [{ referringDoctor: nameRegex(name) }, { notes: notesRe }],
  });

  let updated = 0;
  for (const dentalCase of cases) {
    const nextNotes = setRequesterTypeInNotes(dentalCase.notes || '', requesterType);
    const changed =
      dentalCase.requesterType !== requesterType || String(dentalCase.notes || '') !== nextNotes;
    if (!changed) continue;
    dentalCase.requesterType = requesterType;
    dentalCase.notes = nextNotes;
    await dentalCase.save();
    updated += 1;
  }
  return updated;
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

  const sameRole = await User.findOne({
    fullName: nameRegex(name),
    role,
    isActive: { $ne: false },
  });
  if (sameRole) {
    return { action: 'exists', user: sameRole };
  }

  const otherRole = await User.findOne({
    fullName: nameRegex(name),
    role: { $in: CLIENT_PORTAL_ROLES },
    isActive: { $ne: false },
  }).sort({ createdAt: 1 });

  if (otherRole) {
    otherRole.role = role;
    otherRole.department = departmentForClientRole(role);
    await otherRole.save();
    const updatedCases = await retagCasesForClientName(otherRole.fullName, role);
    return { action: 'converted', user: otherRole, updatedCases };
  }

  const created = await createClientAccount(name, role);
  return { action: 'created', user: created };
}

module.exports = {
  DEFAULT_PASSWORD,
  ensureClientAccount,
  retagCasesForClientName,
};
