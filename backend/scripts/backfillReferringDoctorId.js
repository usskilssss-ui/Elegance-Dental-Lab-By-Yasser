/**
 * Link existing cases to a doctor/student/lab account when the name matches exactly.
 * Ambiguous names (two accounts with the same normalized name) are left unset.
 *
 * Usage (point MONGODB_URI at the database you mean to update):
 *   node scripts/backfillReferringDoctorId.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DentalCase = require('../models/DentalCase');
const User = require('../models/User');
const { normalizeDoctorKey } = require('../services/casePricingService');

const CLIENT_ROLES = ['doctor', 'student', 'lab'];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const users = await User.find({
    role: { $in: CLIENT_ROLES },
    isActive: { $ne: false },
  })
    .select('fullName role')
    .lean();

  const byKey = new Map();
  const ambiguous = new Set();
  for (const user of users) {
    const key = normalizeDoctorKey(user.fullName);
    if (!key) continue;
    if (byKey.has(key)) {
      ambiguous.add(key);
      byKey.delete(key);
      continue;
    }
    if (!ambiguous.has(key)) byKey.set(key, user);
  }

  const cursor = DentalCase.find({
    $or: [{ referringDoctorId: null }, { referringDoctorId: { $exists: false } }],
    referringDoctor: { $nin: [null, ''] },
  })
    .select('referringDoctor')
    .cursor();

  let updated = 0;
  let skipped = 0;
  for await (const doc of cursor) {
    const key = normalizeDoctorKey(doc.referringDoctor);
    const user = key ? byKey.get(key) : null;
    if (!user) {
      skipped += 1;
      continue;
    }
    await DentalCase.updateOne({ _id: doc._id }, { $set: { referringDoctorId: user._id } });
    updated += 1;
  }

  console.log(
    `referringDoctorId backfill: updated ${updated}, skipped ${skipped}, ambiguous names ${ambiguous.size}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
