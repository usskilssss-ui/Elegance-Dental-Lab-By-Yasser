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
    updatedAt: Date,
    stageTimestamps: mongoose.Schema.Types.Mixed
  }, { collection: 'dentalcases', strict: false }));

  const cases = await DentalCase.find({ caseNumber: { $in: ['CASE-2026-00380', 'CASE-2026-00423', 'CASE-2026-00002'] } });

  for (const c of cases) {
    console.log(`\n=== Case: ${c.caseNumber} (${c.patientName}) ===`);
    console.log(`currentStage: ${c.currentStage}`);
    console.log(`createdAt: ${c.createdAt ? c.createdAt.toISOString() : 'null'}`);
    console.log(`updatedAt: ${c.updatedAt ? c.updatedAt.toISOString() : 'null'}`);
    console.log(`stageTimestamps:`, JSON.stringify(c.stageTimestamps, null, 2));
    
    let meta = {};
    if (c.notes && c.notes.startsWith('__META__\n')) {
      try { meta = JSON.parse(c.notes.slice('__META__\n'.length)); } catch (e) {}
    }
    console.log(`receivedDate in notes: ${meta.receivedDate}`);
  }

  await mongoose.disconnect();
}
run();
