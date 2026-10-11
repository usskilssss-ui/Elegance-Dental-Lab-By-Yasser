/**
 * One-time copy of originalEntry onto the case document.
 * List requests no longer write this field while someone is only viewing cases.
 *
 * Usage (point MONGODB_URI at the database you mean to update):
 *   node scripts/backfillOriginalEntry.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DentalCase = require('../models/DentalCase');
const AuditLog = require('../models/AuditLog');
const { parseNotesMeta } = require('../services/casePricingService');

function entryFrom(workType, meta) {
  const type = String(workType || '').trim();
  if (!type) return null;
  const quantity = Number(meta?.quantity);
  return {
    workType: type,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    color: String(meta?.color || '').trim(),
    workDetail: String(meta?.workDetail || '').trim(),
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const cursor = DentalCase.find({
    $or: [{ originalEntry: null }, { originalEntry: { $exists: false } }],
  })
    .select('notes caseType')
    .cursor();

  let updated = 0;
  let skipped = 0;
  for await (const doc of cursor) {
    const meta = parseNotesMeta(doc.notes || '');
    let entry = entryFrom(meta?.originalEntry?.workType, {
      ...meta,
      quantity: meta?.originalEntry?.quantity ?? meta?.quantity,
      color: meta?.originalEntry?.color ?? meta?.color,
      workDetail: meta?.originalEntry?.workDetail ?? meta?.workDetail,
    });
    if (!entry) {
      const audit = await AuditLog.findOne({ caseId: doc._id, action: 'created' })
        .select('details')
        .lean();
      entry = entryFrom(audit?.details?.newValue?.caseType || doc.caseType, meta);
    }
    if (!entry) {
      skipped += 1;
      continue;
    }
    await DentalCase.updateOne({ _id: doc._id }, { $set: { originalEntry: entry } });
    updated += 1;
  }

  console.log(`originalEntry backfill: updated ${updated}, skipped ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
