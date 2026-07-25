const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const DentalCase = mongoose.model('DentalCase', new mongoose.Schema({
    caseNumber: String,
    patientName: String,
    notes: String,
    currentStage: String,
    createdAt: Date,
    stageTimestamps: mongoose.Schema.Types.Mixed
  }, { collection: 'dentalcases', strict: false }));

  const cases = await DentalCase.find({ currentStage: 'exited' }).limit(20);

  console.log(`\nSample of exited cases (20):\n`);
  for (const c of cases) {
    let meta = {};
    if (c.notes && c.notes.startsWith('__META__\n')) {
      try { meta = JSON.parse(c.notes.slice('__META__\n'.length)); } catch (e) {}
    }

    const receivedDate = meta.receivedDate || 'غير موجود';
    const exitedAt = c.stageTimestamps?.exited || 'غير موجود';
    const completedAt = c.stageTimestamps?.completed || 'غير موجود';

    console.log(`${c.caseNumber} (${c.patientName})`);
    console.log(`  تاريخ الاستلام (الدخول): ${receivedDate}`);
    console.log(`  تاريخ الانتهاء (completed): ${completedAt}`);
    console.log(`  تاريخ الخروج (exited):     ${exitedAt}`);
    console.log('');
  }

  await mongoose.disconnect();
}
run();
