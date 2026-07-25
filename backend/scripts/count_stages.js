const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    const DentalCase = mongoose.model('DentalCase', new mongoose.Schema({
      currentStage: String
    }, { collection: 'dentalcases' }));

    console.log('Counting cases by stage...');
    const stages = ['waiting', 'secretary', 'design', 'khart', 'finishing', 'completed', 'exited'];
    
    const results = {};
    for (const stage of stages) {
      const count = await DentalCase.countDocuments({ currentStage: stage });
      results[stage] = count;
    }

    const total = await DentalCase.countDocuments();
    console.log('\n--- Breakdown of Stages ---');
    console.log(JSON.stringify(results, null, 2));
    console.log(`Total cases in DB: ${total}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
