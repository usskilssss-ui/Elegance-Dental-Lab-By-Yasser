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
      currentStage: String,
      stageTimestamps: {
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases' }));

    console.log('Searching for cases that exited on July 17, 2026...');

    // UTC+3 timezone (17 July in Egypt/KSA is 2026-07-16 21:00:00 UTC to 2026-07-17 21:00:00 UTC)
    const localStart = new Date('2026-07-16T21:00:00.000Z');
    const localEnd = new Date('2026-07-17T21:00:00.000Z');

    const exitedCases = await DentalCase.find({
      currentStage: 'exited',
      'stageTimestamps.exited': { $gte: localStart, $lte: localEnd }
    });

    console.log(`Found ${exitedCases.length} cases.`);

    if (exitedCases.length === 0) {
      console.log('No cases found to update.');
      return;
    }

    console.log('Updating dates to July 1, 2026...');

    let updatedCount = 0;
    for (const c of exitedCases) {
      const originalExitDate = c.stageTimestamps.exited;
      
      // Update exited timestamp
      const newExitDate = new Date(originalExitDate);
      newExitDate.setUTCDate(1); // Set day of month to 1 (July 1, 2026)
      c.stageTimestamps.exited = newExitDate;

      // Update completed timestamp if it is also on July 17
      if (c.stageTimestamps.completed) {
        const compTime = c.stageTimestamps.completed.getTime();
        if (compTime >= localStart.getTime() && compTime <= localEnd.getTime()) {
          const newCompletedDate = new Date(c.stageTimestamps.completed);
          newCompletedDate.setUTCDate(1);
          c.stageTimestamps.completed = newCompletedDate;
        }
      }

      await c.save();
      console.log(`Updated ${c.caseNumber} (${c.patientName}): ${originalExitDate.toISOString()} -> ${newExitDate.toISOString()}`);
      updatedCount++;
    }

    console.log(`\nSuccessfully updated ${updatedCount} cases.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
