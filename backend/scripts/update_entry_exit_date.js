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
      notes: String,
      createdAt: Date,
      stageTimestamps: {
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases', strict: false }));

    const exitedCases = await DentalCase.find({ currentStage: 'exited' });
    console.log(`Found ${exitedCases.length} exited cases.`);

    let updatedCount = 0;

    for (const c of exitedCases) {
      const match = c.caseNumber.match(/CASE-\d+-(\d+)/);
      if (!match) continue;

      const num = parseInt(match[1], 10);
      if (num >= 12 && num <= 62) {
        console.log(`\nUpdating ${c.caseNumber} (${c.patientName}):`);

        // 1. Update exited timestamp (preserving time)
        if (c.stageTimestamps && c.stageTimestamps.exited) {
          const oldExited = new Date(c.stageTimestamps.exited);
          const newExited = new Date(oldExited);
          newExited.setUTCFullYear(2026);
          newExited.setUTCMonth(6); // July (0-indexed)
          newExited.setUTCDate(8);
          c.stageTimestamps.exited = newExited;
          console.log(`  Exited: ${oldExited.toISOString()} -> ${newExited.toISOString()}`);
        } else {
          // If for some reason it doesn't exist, create it on July 8
          const newExited = new Date();
          newExited.setUTCFullYear(2026);
          newExited.setUTCMonth(6);
          newExited.setUTCDate(8);
          c.stageTimestamps = c.stageTimestamps || {};
          c.stageTimestamps.exited = newExited;
          console.log(`  Exited: Created on July 8 -> ${newExited.toISOString()}`);
        }

        // 2. Update completed timestamp if it exists (preserving time)
        if (c.stageTimestamps && c.stageTimestamps.completed) {
          const oldCompleted = new Date(c.stageTimestamps.completed);
          const newCompleted = new Date(oldCompleted);
          newCompleted.setUTCFullYear(2026);
          newCompleted.setUTCMonth(6);
          newCompleted.setUTCDate(8);
          c.stageTimestamps.completed = newCompleted;
          console.log(`  Completed: ${oldCompleted.toISOString()} -> ${newCompleted.toISOString()}`);
        }

        // 3. Update notes metadata (receivedDate)
        let meta = {};
        if (c.notes && c.notes.startsWith('__META__\n')) {
          try {
            meta = JSON.parse(c.notes.slice('__META__\n'.length));
          } catch (e) {}
        }

        const oldReceivedDate = meta.receivedDate;
        let newReceivedDate = '';
        if (oldReceivedDate) {
          // Format is typically "YYYY-MM-DD HH:mm:ss"
          // We can replace the date part with "2026-07-08"
          const parts = oldReceivedDate.split(' ');
          if (parts.length === 2) {
            newReceivedDate = `2026-07-08 ${parts[1]}`;
          } else {
            newReceivedDate = `2026-07-08 12:00:00`;
          }
        } else {
          // Default to July 8 at 12:00:00
          newReceivedDate = `2026-07-08 12:00:00`;
        }
        meta.receivedDate = newReceivedDate;
        c.notes = '__META__\n' + JSON.stringify(meta);
        console.log(`  ReceivedDate: ${oldReceivedDate || 'none'} -> ${newReceivedDate}`);

        // 4. Update createdAt (preserving time)
        if (c.createdAt) {
          const oldCreatedAt = new Date(c.createdAt);
          const newCreatedAt = new Date(oldCreatedAt);
          newCreatedAt.setUTCFullYear(2026);
          newCreatedAt.setUTCMonth(6);
          newCreatedAt.setUTCDate(8);
          c.createdAt = newCreatedAt;
          console.log(`  createdAt: ${oldCreatedAt.toISOString()} -> ${newCreatedAt.toISOString()}`);
        }

        await c.save();
        updatedCount++;
      }
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
