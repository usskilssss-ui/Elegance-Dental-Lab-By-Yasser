/**
 * Merge a duplicate doctor (usually a typo) into the real one.
 *
 * DRY RUN by default — prints what would change and touches nothing.
 *   node scripts/mergeDoctors.js --from "غلي غبدالله" --into "علي عبدالله"
 * Apply for real (point MONGODB_URI at the right database first):
 *   node scripts/mergeDoctors.js --from "غلي غبدالله" --into "علي عبدالله" --apply --by admin@lab.com
 *
 * What it changes:
 *   - Cases: referringDoctor, notes meta doctor name, referringDoctorId → the real doctor.
 *     Money on exited cases (billSnapshot amounts, revenueAmount, prices) is NOT changed.
 *   - Doctor payments / charges: doctorName → the real doctor.
 *   - Doctor price list: the real doctor's prices win; keys only the duplicate had are copied over;
 *     the duplicate's price row is removed.
 *   - The duplicate's login account is deactivated (not deleted).
 * Every change is written to the audit log as "doctor_merged".
 */
require('dotenv').config();
const mongoose = require('mongoose');
const DentalCase = require('../models/DentalCase');
const DoctorPayment = require('../models/DoctorPayment');
const DoctorPricing = require('../models/DoctorPricing');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { normalizeDoctorKey } = require('../utils/doctorName');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
}

const META = '__META__\n';
function renameInNotes(notes, fromKey, into) {
  const raw = String(notes || '');
  if (!raw.startsWith(META)) return raw;
  try {
    const meta = JSON.parse(raw.slice(META.length));
    let changed = false;
    for (const k of ['doctor', 'doctorName']) {
      if (meta[k] && normalizeDoctorKey(meta[k]) === fromKey) {
        meta[k] = into;
        changed = true;
      }
    }
    return changed ? META + JSON.stringify(meta) : raw;
  } catch {
    return raw;
  }
}

async function main() {
  const from = arg('--from');
  const into = arg('--into');
  const apply = process.argv.includes('--apply');
  const byEmail = arg('--by');
  if (!from || !into) {
    console.error('Usage: node scripts/mergeDoctors.js --from "<duplicate name>" --into "<real name>" [--apply]');
    process.exit(2);
  }
  const fromKey = normalizeDoctorKey(from);
  const intoKey = normalizeDoctorKey(into);
  if (!fromKey || !intoKey || fromKey === intoKey) {
    console.error('Names are empty or already the same doctor — nothing to merge.');
    process.exit(2);
  }

  if (apply && !byEmail) {
    console.error('--apply needs --by <admin email> so the audit log shows who merged.');
    process.exit(2);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const admin = apply ? await User.findOne({ email: byEmail.toLowerCase(), role: 'admin' }) : null;
  if (apply && !admin) {
    console.error(`No admin account with email ${byEmail}.`);
    await mongoose.disconnect();
    process.exit(2);
  }
  console.log(apply ? '*** APPLYING CHANGES ***' : 'Dry run — nothing will be written. Add --apply to merge.');

  const clients = await User.find({ role: { $in: ['doctor', 'student', 'lab'] } });
  const intoUser = clients.find((u) => normalizeDoctorKey(u.fullName) === intoKey) || null;
  const fromUsers = clients.filter((u) => normalizeDoctorKey(u.fullName) === fromKey);

  const cases = (await DentalCase.find({}).select('caseNumber referringDoctor referringDoctorId notes currentStage'))
    .filter((c) => {
      const meta = (() => { try { return String(c.notes || '').startsWith(META) ? JSON.parse(c.notes.slice(META.length)) : {}; } catch { return {}; } })();
      return [c.referringDoctor, meta.doctor, meta.doctorName].some((n) => n && normalizeDoctorKey(n) === fromKey)
        || fromUsers.some((u) => c.referringDoctorId && String(c.referringDoctorId) === String(u._id));
    });
  const payments = (await DoctorPayment.find({})).filter((p) => normalizeDoctorKey(p.doctorName) === fromKey);
  const pricings = await DoctorPricing.find({});
  const fromPricing = pricings.filter((p) => normalizeDoctorKey(p.doctorName) === fromKey);
  const intoPricing = pricings.find((p) => normalizeDoctorKey(p.doctorName) === intoKey) || null;

  console.log(`Merge "${from}" → "${into}"`);
  console.log(`  cases to relink:        ${cases.length} (${cases.filter((c) => c.currentStage === 'exited').length} exited — bill amounts untouched)`);
  console.log(`  payments to rename:     ${payments.length}`);
  console.log(`  price rows to fold in:  ${fromPricing.length}${intoPricing ? '' : ' (real doctor has no price row; it will be renamed)'}`);
  console.log(`  accounts to deactivate: ${fromUsers.map((u) => u.fullName).join(', ') || 'none'}`);
  console.log(`  real doctor account:    ${intoUser ? intoUser.fullName : 'none found — cases keep their current account link'}`);
  cases.slice(0, 20).forEach((c) => console.log(`    - ${c.caseNumber} (${c.currentStage})`));
  if (cases.length > 20) console.log(`    … and ${cases.length - 20} more`);

  if (!apply) {
    await mongoose.disconnect();
    return;
  }

  for (const c of cases) {
    c.referringDoctor = into;
    c.notes = renameInNotes(c.notes, fromKey, into);
    if (intoUser) c.referringDoctorId = intoUser._id;
    await c.save({ validateModifiedOnly: true });
    await AuditLog.create({
      caseId: c._id,
      caseNumber: c.caseNumber,
      action: 'doctor_merged',
      performedBy: admin._id,
      performedByName: admin.fullName,
      details: { oldValue: from, newValue: into, notes: 'scripts/mergeDoctors.js' },
    });
  }
  for (const p of payments) {
    p.doctorName = into;
    await p.save();
  }
  if (fromPricing.length) {
    if (intoPricing) {
      const merged = {};
      for (const row of fromPricing) Object.assign(merged, row.prices || {});
      intoPricing.prices = { ...merged, ...(intoPricing.prices || {}) };
      intoPricing.markModified('prices');
      await intoPricing.save();
      for (const row of fromPricing) await row.deleteOne();
    } else {
      const [first, ...rest] = fromPricing;
      first.doctorName = into;
      await first.save();
      for (const row of rest) await row.deleteOne();
    }
  }
  for (const u of fromUsers) {
    u.isActive = false;
    await u.save();
  }
  console.log('Done.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
