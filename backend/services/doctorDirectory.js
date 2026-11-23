/**
 * Doctor directory: the set of doctor names the lab already knows, and the
 * "did you mean …?" gate that stops a typo from silently creating a new
 * doctor (new account, separate bill, lab-default prices).
 */
const { normalizeDoctorKey, findSimilarDoctorNames } = require('../utils/doctorName');

/**
 * Pure decision used by case creation.
 * @returns {{action:'ok'|'similar', existing:string|null, similar:string[]}}
 */
function decideDoctorName(name, knownNames, confirmedNew) {
  const key = normalizeDoctorKey(name);
  if (!key) return { action: 'ok', existing: null, similar: [] };
  const existing = (knownNames || []).find((n) => normalizeDoctorKey(n) === key) || null;
  if (existing) return { action: 'ok', existing, similar: [] };
  if (confirmedNew) return { action: 'ok', existing: null, similar: [] };
  const similar = findSimilarDoctorNames(name, knownNames);
  return similar.length
    ? { action: 'similar', existing: null, similar }
    : { action: 'ok', existing: null, similar: [] };
}

/** Distinct doctor names from client accounts and from cases. */
async function listKnownDoctorNames() {
  const User = require('../models/User');
  const DentalCase = require('../models/DentalCase');
  const [users, caseNames] = await Promise.all([
    User.find({ role: { $in: ['doctor', 'student', 'lab'] } }).select('fullName').lean(),
    DentalCase.distinct('referringDoctor'),
  ]);
  const byKey = new Map();
  for (const n of [...users.map((u) => u.fullName), ...caseNames]) {
    const name = String(n || '').trim();
    const key = normalizeDoctorKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()];
}

async function checkDoctorName(name, confirmedNew) {
  return decideDoctorName(name, await listKnownDoctorNames(), confirmedNew);
}

module.exports = { decideDoctorName, listKnownDoctorNames, checkDoctorName };
