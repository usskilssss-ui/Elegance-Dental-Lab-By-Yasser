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
      status: String,
      createdAt: Date,
      stageTimestamps: {
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases' }));

    console.log('Identifying finished/exited cases whose createdAt is NOT July 4, 2026 (local time UTC+3)...');

    // Local time July 4, 2026 is between 2026-07-03 21:00:00 UTC and 2026-07-04 21:00:00 UTC
    const localStart = new Date('2026-07-03T21:00:00.000Z');
    const localEnd = new Date('2026-07-04T21:00:00.000Z');

    // Query finished/exited cases
    const finishedCases = await DentalCase.find({
      currentStage: { $in: ['completed', 'exited'] }
    });

    console.log(`Total finished/exited cases found: ${finishedCases.length}`);

    const casesToRevert = [];
    const casesToKeep = [];

    for (const c of finishedCases) {
      const createdTime = c.createdAt.getTime();
      const isOnJuly4 = createdTime >= localStart.getTime() && createdTime < localEnd.getTime();
      
      if (!isOnJuly4) {
        casesToRevert.push(c);
      } else {
        casesToKeep.push(c);
      }
    }

    console.log(`Cases that will remain finished (entered on July 4): ${casesToKeep.length}`);
    console.log(`Cases to revert (entered on other dates): ${casesToRevert.length}`);

    if (casesToRevert.length === 0) {
      console.log('No cases to revert.');
      return;
    }

    console.log('\nReverting cases to "waiting" stage...');
    let revertedCount = 0;
    
    for (const c of casesToRevert) {
      const oldStage = c.currentStage;
      c.currentStage = 'waiting';
      c.status = 'waiting';
      
      if (c.stageTimestamps) {
        c.stageTimestamps.completed = null;
        c.stageTimestamps.exited = null;
      }
      
      await c.save();
      console.log(`Reverted ${c.caseNumber} (${c.patientName}) - Created: ${c.createdAt.toISOString()} - Old stage: ${oldStage}`);
      revertedCount++;
    }

    console.log(`\nSuccessfully reverted ${revertedCount} cases to new cases section.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
