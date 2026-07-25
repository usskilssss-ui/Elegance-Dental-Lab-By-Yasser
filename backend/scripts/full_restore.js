const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

// This is the log from restore_cases.js (task-1539) which has the original stages and timestamps
const LOG_FILE = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\3dc14e52-d06d-4547-bf48-7fd4a8c483f8\\.system_generated\\tasks\\task-1539.log';

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
      stageTimestamps: mongoose.Schema.Types.Mixed
    }, { collection: 'dentalcases', strict: false }));

    // Parse the restore log to get original stages and timestamps for each case
    console.log('Parsing restore log...');
    const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = logContent.split('\n');

    // Pattern: Restored CASE-2026-00282 (ضحى) -> Stage: completed, Completed: 2026-07-17T18:44:30.529Z, Exited: null
    const restoreRegex = /Restored (CASE-\d+-\d+) \((.*?)\) -> Stage: (\w+), Completed: ([\d\-T:.Z]+|null), Exited: ([\d\-T:.Z]+|null)/;

    const originalData = {};
    for (const line of lines) {
      const match = line.match(restoreRegex);
      if (match) {
        originalData[match[1]] = {
          caseNumber: match[1],
          patientName: match[2],
          stage: match[3],
          completed: match[4] === 'null' ? null : new Date(match[4]),
          exited: match[5] === 'null' ? null : new Date(match[5])
        };
      }
    }

    console.log(`Parsed ${Object.keys(originalData).length} cases from restore log.`);

    // Now restore the 437 cases that were moved to "waiting" by task-1568
    // These are cases currently in "waiting" stage that have original data in the log
    const waitingCases = await DentalCase.find({ currentStage: 'waiting' });
    console.log(`Found ${waitingCases.length} cases currently in waiting stage.`);

    let restoredCount = 0;
    let skippedCount = 0;

    for (const c of waitingCases) {
      const orig = originalData[c.caseNumber];
      if (!orig) {
        // This case was originally in waiting - skip it
        skippedCount++;
        continue;
      }

      // Restore original stage and timestamps
      c.currentStage = orig.stage;
      c.status = orig.stage;

      if (!c.stageTimestamps) c.stageTimestamps = {};
      c.stageTimestamps.completed = orig.completed;
      c.stageTimestamps.exited = orig.exited;

      await c.save();
      console.log(`Restored ${c.caseNumber} (${c.patientName}) -> Stage: ${orig.stage}, Completed: ${orig.completed ? orig.completed.toISOString() : 'null'}, Exited: ${orig.exited ? orig.exited.toISOString() : 'null'}`);
      restoredCount++;
    }

    console.log(`\nSuccessfully restored ${restoredCount} cases to their original stages.`);
    console.log(`Skipped ${skippedCount} cases (were originally in waiting).`);

    // Final count
    const total = await DentalCase.countDocuments();
    const exited = await DentalCase.countDocuments({ currentStage: 'exited' });
    const completed = await DentalCase.countDocuments({ currentStage: 'completed' });
    const waiting = await DentalCase.countDocuments({ currentStage: 'waiting' });
    const other = await DentalCase.countDocuments({ currentStage: { $nin: ['waiting', 'completed', 'exited'] } });

    console.log(`\n=== النتيجة النهائية ===`);
    console.log(`إجمالي الحالات: ${total}`);
    console.log(`حالات جديدة (waiting): ${waiting}`);
    console.log(`حالات منتهية (completed): ${completed}`);
    console.log(`حالات خارجة (exited): ${exited}`);
    console.log(`مراحل أخرى: ${other}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
