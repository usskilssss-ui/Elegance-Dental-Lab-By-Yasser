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

    const cases = await DentalCase.find({ currentStage: { $in: ['exited', 'completed'] } });
    console.log(`Found ${cases.length} cases to fix.`);

    let fixedCount = 0;

    for (const c of cases) {
      // Fetch audit logs belonging to this EXACT document ID (caseId)
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
      const numPart = parseInt(c.caseNumber.split('-')[2], 10);
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

      // Assign the precise dates (overwriting any old/incorrectly copied dates)
      c.stageTimestamps = c.stageTimestamps || {};
      c.stageTimestamps.completed = completedTime;
      c.stageTimestamps.exited = exitedTime;

      await c.save();
      console.log(`Fixed ${c.caseNumber} (${c.patientName}) -> Completed: ${completedTime ? completedTime.toISOString() : 'null'}, Exited: ${exitedTime ? exitedTime.toISOString() : 'null'}`);
      fixedCount++;
    }

    console.log(`\nSuccessfully corrected timestamps for ${fixedCount} cases.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
