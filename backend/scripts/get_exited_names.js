const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    const DentalCase = mongoose.model('DentalCase', new mongoose.Schema({
      caseNumber: String,
      patientName: String,
      currentStage: String
    }, { collection: 'dentalcases' }));

    const exitedCases = await DentalCase.find({ currentStage: 'exited' });
    console.log(`Found ${exitedCases.length} total exited cases.`);

    const results = [];
    for (const c of exitedCases) {
      const match = c.caseNumber.match(/CASE-\d+-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num >= 12 && num <= 62) {
          results.push({
            caseNumber: c.caseNumber,
            patientName: c.patientName
          });
        }
      }
    }

    results.sort((a, b) => a.caseNumber.localeCompare(b.caseNumber));

    console.log(`\n=== الحالات الخارجة من 12 إلى 62 (${results.length} حالة) ===\n`);
    for (const res of results) {
      console.log(`${res.caseNumber}: ${res.patientName}`);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
