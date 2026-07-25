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
      currentStage: String,
      status: String,
      stageTimestamps: {
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases' }));

    console.log('Identifying finished/exited cases whose received date (in notes) is NOT July 4, 2026...');

    const cases = await DentalCase.find({ currentStage: { $in: ['completed', 'exited'] } });
    console.log(`Total finished/exited cases in DB: ${cases.length}`);

    const casesToRevert = [];
    const casesToKeep = [];

    for (const c of cases) {
      let meta = {};
      if (c.notes && c.notes.startsWith('__META__\n')) {
        try {
          meta = JSON.parse(c.notes.slice('__META__\n'.length));
        } catch (e) {}
      }
      
      const rDateStr = meta.receivedDate;
      let isJuly4 = false;
      
      if (rDateStr) {
        const parsedDate = new Date(rDateStr);
        const isValid = !isNaN(parsedDate.getTime());
        if (isValid) {
          isJuly4 = parsedDate.getFullYear() === 2026 && parsedDate.getMonth() === 6 && parsedDate.getDate() === 4;
        } else {
          isJuly4 = rDateStr.includes('2026-07-04') || rDateStr.includes('04-07-2026') || rDateStr.includes('4-7-2026') || rDateStr.includes('7/4/2026');
        }
      }

      if (isJuly4) {
        casesToKeep.push(c);
      } else {
        casesToRevert.push(c);
      }
    }

    console.log(`Cases that will remain finished/exited (received on July 4): ${casesToKeep.length}`);
    console.log(`Cases to revert to waiting (received on other dates): ${casesToRevert.length}`);

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
      console.log(`Reverted ${c.caseNumber} (${c.patientName}) - Old stage: ${oldStage}`);
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
