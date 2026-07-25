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
      notes: String,
      currentStage: String
    }, { collection: 'dentalcases' }));

    const cases = await DentalCase.find({ currentStage: { $in: ['completed', 'exited'] } }).limit(20);
    
    console.log('Inspecting notes meta for 20 finished/exited cases:');
    for (const c of cases) {
      let meta = {};
      if (c.notes && c.notes.startsWith('__META__\n')) {
        try {
          meta = JSON.parse(c.notes.slice('__META__\n'.length));
        } catch (e) {}
      }
      console.log(`- ${c.caseNumber} (${c.patientName}): notes format has receivedDate: "${meta.receivedDate}"`);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
