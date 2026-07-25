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

  const cases = await DentalCase.find({ currentStage: 'exited' });
  
  const results = [];
  for (const c of cases) {
    const match = c.caseNumber.match(/CASE-\d+-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 12 && num <= 62) {
        let meta = {};
        if (c.notes && c.notes.startsWith('__META__\n')) {
          try { meta = JSON.parse(c.notes.slice('__META__\n'.length)); } catch (e) {}
        }
        results.push({
          caseNumber: c.caseNumber,
          patientName: c.patientName,
          createdAt: c.createdAt ? c.createdAt.toISOString() : 'null',
          exited: c.stageTimestamps?.exited ? new Date(c.stageTimestamps.exited).toISOString() : 'null',
          receivedDate: meta.receivedDate || 'none'
        });
      }
    }
  }

  results.sort((a, b) => a.caseNumber.localeCompare(b.caseNumber));
  
  console.log(JSON.stringify(results, null, 2));

  await mongoose.disconnect();
}
run();
