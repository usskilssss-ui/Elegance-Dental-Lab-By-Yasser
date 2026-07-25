const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';
const LOG_FILE_PATH = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\3dc14e52-d06d-4547-bf48-7fd4a8c483f8\\.system_generated\\tasks\\task-1539.log';

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
      stageTimestamps: {
        secretary: Date,
        design: Date,
        khart: Date,
        finishing: Date,
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases', strict: false }));

    const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
      caseId: mongoose.Schema.Types.ObjectId,
      caseNumber: String,
      action: String,
      details: mongoose.Schema.Types.Mixed,
      timestamp: Date
    }, { collection: 'auditlogs' }));

    console.log('Reading log file to parse all reverted cases and their original stages...');
    const logContent = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const lines = logContent.split('\n');

    // Pattern: Restored CASE-2026-00282 (ضحى) -> Stage: completed, Completed: ...
    const regex = /Restored (CASE-\d+-\d+) \((.*?)\) -> Stage: (\w+)/;
    const casesToRestore = [];

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        casesToRestore.push({
          caseNumber: match[1],
          patientName: match[2],
          originalStage: match[3]
        });
      }
    }

    console.log(`Parsed ${casesToRestore.length} cases to restore.`);
    if (casesToRestore.length === 0) {
      console.log('No cases found in log file.');
      return;
    }

    console.log('Restoring stages and timestamps precisely using caseId...');
    let restoredCount = 0;

    for (const item of casesToRestore) {
      const c = await DentalCase.findOne({ caseNumber: item.caseNumber });
      if (!c) {
        console.warn(`Case not found in database: ${item.caseNumber}`);
        continue;
      }

      // Restore stage and status
      c.currentStage = item.originalStage;
      c.status = item.originalStage;

      // Find precise timestamps using c._id
      const logs = await AuditLog.find({ caseId: c._id }).sort({ timestamp: 1 });

      let completedTime = null;
      let exitedTime = null;

      for (const log of logs) {
        if (log.action === 'completed' ||
            (log.action === 'moved_stage' && log.details && log.details.newValue === 'completed')) {
          completedTime = log.timestamp;
        }
        if (log.action === 'exited' ||
            (log.action === 'moved_stage' && log.details && log.details.newValue === 'exited')) {
          exitedTime = log.timestamp;
        }
      }

      // Handle the special July 1st & July 2nd exit dates for the requested groups
      const numPart = parseInt(item.caseNumber.split('-')[2], 10);
      if (numPart >= 380 && numPart <= 422 && exitedTime) {
        const d = new Date(exitedTime);
        d.setFullYear(2026);
        d.setMonth(6); // July
        d.setDate(1);
        exitedTime = d;
      } else if (numPart >= 423 && numPart <= 461 && exitedTime) {
        const d = new Date(exitedTime);
        d.setFullYear(2026);
        d.setMonth(6); // July
        d.setDate(2);
        exitedTime = d;
      }

      c.stageTimestamps = c.stageTimestamps || {};
      c.stageTimestamps.completed = completedTime;
      c.stageTimestamps.exited = exitedTime;

      await c.save();
      console.log(`Restored ${c.caseNumber} (${c.patientName}) -> Stage: ${c.currentStage}, Completed: ${completedTime ? completedTime.toISOString() : 'null'}, Exited: ${exitedTime ? exitedTime.toISOString() : 'null'}`);
      restoredCount++;
    }

    console.log(`\nSuccessfully restored ${restoredCount} cases to their original stages and precise timestamps.`);

    // Print final DB counts
    const total = await DentalCase.countDocuments();
    const exited = await DentalCase.countDocuments({ currentStage: 'exited' });
    const completed = await DentalCase.countDocuments({ currentStage: 'completed' });
    const waiting = await DentalCase.countDocuments({ currentStage: 'waiting' });

    console.log(`\n=== النتيجة النهائية في قاعدة البيانات ===`);
    console.log(`إجمالي الحالات: ${total}`);
    console.log(`حالات جديدة (waiting): ${waiting}`);
    console.log(`حالات منتهية (completed): ${completed}`);
    console.log(`حالات خارجة (exited): ${exited}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
