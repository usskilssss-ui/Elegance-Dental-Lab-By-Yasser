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

    // Get all exited and completed cases
    const cases = await DentalCase.find({ currentStage: { $in: ['exited', 'completed'] } });
    console.log(`Found ${cases.length} exited/completed cases to fix timestamps.`);

    let fixedCount = 0;

    for (const c of cases) {
      // Get ALL audit logs for this case, sorted by time (newest first)
      // We need the LAST "created" action to know when this version of the case was created
      // Then find the exited/completed actions AFTER that creation
      const allLogs = await AuditLog.find({ caseNumber: c.caseNumber }).sort({ timestamp: 1 });

      if (allLogs.length === 0) continue;

      // Find the last "created" action - this is the current incarnation of the case
      let lastCreatedIdx = -1;
      for (let i = allLogs.length - 1; i >= 0; i--) {
        if (allLogs[i].action === 'created') {
          lastCreatedIdx = i;
          break;
        }
      }

      // Only look at audit logs AFTER the last creation
      const relevantLogs = lastCreatedIdx >= 0 ? allLogs.slice(lastCreatedIdx) : allLogs;

      // Find completed timestamp - LAST completed or moved_stage to completed
      let completedTime = null;
      for (const log of relevantLogs) {
        if (log.action === 'completed' ||
            (log.action === 'moved_stage' && log.details && log.details.newValue === 'completed')) {
          completedTime = log.timestamp;
        }
      }

      // Find exited timestamp - LAST exited action
      let exitedTime = null;
      for (const log of relevantLogs) {
        if (log.action === 'exited' ||
            (log.action === 'moved_stage' && log.details && log.details.newValue === 'exited')) {
          exitedTime = log.timestamp;
        }
      }

      // Now handle the special date changes user requested earlier:
      // Cases 380-422 had exit date changed to July 1, 2026
      // Cases 423-461 had exit date changed to July 2, 2026
      const numPart = parseInt(c.caseNumber.split('-')[2], 10);

      if (numPart >= 380 && numPart <= 422 && exitedTime) {
        // Set exit date to July 1, 2026, keeping the same time
        const d = new Date(exitedTime);
        // Original exited time was on July 17, change to July 1
        d.setFullYear(2026);
        d.setMonth(6); // July (0-indexed)
        d.setDate(1);
        exitedTime = d;
      } else if (numPart >= 423 && numPart <= 461 && exitedTime) {
        // Set exit date to July 2, 2026, keeping the same time
        const d = new Date(exitedTime);
        d.setFullYear(2026);
        d.setMonth(6);
        d.setDate(2);
        exitedTime = d;
      }

      // Update stageTimestamps
      if (!c.stageTimestamps) c.stageTimestamps = {};
      
      let changed = false;

      if (completedTime) {
        c.stageTimestamps.completed = completedTime;
        changed = true;
      }
      if (exitedTime) {
        c.stageTimestamps.exited = exitedTime;
        changed = true;
      }

      if (changed) {
        await c.save();
        fixedCount++;
        console.log(`Fixed ${c.caseNumber} (${c.patientName}) - Completed: ${completedTime ? completedTime.toISOString() : 'null'}, Exited: ${exitedTime ? exitedTime.toISOString() : 'null'}`);
      }
    }

    console.log(`\nFixed timestamps for ${fixedCount} cases.`);

    // Verify with sample
    console.log('\n=== Verification Sample (first 10 exited) ===');
    const sample = await DentalCase.find({ currentStage: 'exited' }).limit(10);
    for (const s of sample) {
      console.log(`${s.caseNumber} (${s.patientName}): Completed=${s.stageTimestamps?.completed || 'null'}, Exited=${s.stageTimestamps?.exited || 'null'}`);
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
