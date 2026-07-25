const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';
const LOG_FILE_PATH = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\3dc14e52-d06d-4547-bf48-7fd4a8c483f8\\.system_generated\\tasks\\task-1483.log';

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
        completed: Date,
        exited: Date
      }
    }, { collection: 'dentalcases' }));

    const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
      caseId: mongoose.Schema.Types.ObjectId,
      caseNumber: String,
      action: String,
      details: mongoose.Schema.Types.Mixed,
      timestamp: Date
    }, { collection: 'auditlogs' }));

    console.log('Reading log file to parse reverted cases...');
    const logContent = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    const lines = logContent.split('\n');

    const revertedCases = [];
    const regex = /Reverted (CASE-\d+-\d+) \((.*?)\) - Created: .*? - Old stage: (completed|exited)/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        revertedCases.push({
          caseNumber: match[1],
          patientName: match[2],
          oldStage: match[3]
        });
      }
    }

    console.log(`Parsed ${revertedCases.length} reverted cases from log file.`);
    if (revertedCases.length === 0) {
      console.log('No cases found in log file.');
      return;
    }

    console.log('Restoring cases...');
    let restoredCount = 0;

    for (const item of revertedCases) {
      const c = await DentalCase.findOne({ caseNumber: item.caseNumber });
      if (!c) {
        console.warn(`Case not found in database: ${item.caseNumber}`);
        continue;
      }

      // Revert stage and status
      c.currentStage = item.oldStage;
      c.status = item.oldStage;

      // Find original timestamps from AuditLog
      const auditLogs = await AuditLog.find({ caseNumber: item.caseNumber }).sort({ timestamp: -1 });

      let originalCompleted = null;
      let originalExited = null;

      // Find completed timestamp
      const completedLog = auditLogs.find(log => 
        log.action === 'completed' || 
        (log.action === 'moved_stage' && log.details && log.details.newValue === 'completed')
      );
      if (completedLog) {
        originalCompleted = new Date(completedLog.timestamp);
      }

      // Find exited timestamp
      const exitedLog = auditLogs.find(log => 
        log.action === 'exited' || 
        (log.action === 'moved_stage' && log.details && log.details.newValue === 'exited')
      );
      if (exitedLog) {
        originalExited = new Date(exitedLog.timestamp);
      }

      // Adjust dates for the July 1 / July 2 groups
      // Group 1: July 1 (CASE-2026-00380 to CASE-2026-00422)
      // Group 2: July 2 (CASE-2026-00423 to CASE-2026-00461)
      const numPart = parseInt(item.caseNumber.split('-')[2], 10);
      
      if (numPart >= 380 && numPart <= 422) {
        if (originalExited) {
          originalExited.setUTCDate(1); // Set day to July 1
        }
        if (originalCompleted) {
          // Check if completed was also on July 17
          const localStart = new Date('2026-07-16T21:00:00.000Z');
          const localEnd = new Date('2026-07-17T21:00:00.000Z');
          if (originalCompleted.getTime() >= localStart.getTime() && originalCompleted.getTime() <= localEnd.getTime()) {
            originalCompleted.setUTCDate(1);
          }
        }
      } else if (numPart >= 423 && numPart <= 461) {
        if (originalExited) {
          originalExited.setUTCDate(2); // Set day to July 2
        }
        if (originalCompleted) {
          const localStart = new Date('2026-07-16T21:00:00.000Z');
          const localEnd = new Date('2026-07-17T21:00:00.000Z');
          if (originalCompleted.getTime() >= localStart.getTime() && originalCompleted.getTime() <= localEnd.getTime()) {
            originalCompleted.setUTCDate(2);
          }
        }
      }

      // Restore stageTimestamps
      c.stageTimestamps = c.stageTimestamps || {};
      c.stageTimestamps.completed = originalCompleted;
      c.stageTimestamps.exited = originalExited;

      await c.save();
      console.log(`Restored ${c.caseNumber} (${c.patientName}) -> Stage: ${c.currentStage}, Completed: ${originalCompleted ? originalCompleted.toISOString() : 'null'}, Exited: ${originalExited ? originalExited.toISOString() : 'null'}`);
      restoredCount++;
    }

    console.log(`\nSuccessfully restored ${restoredCount} cases to their original stage and timestamps.`);

  } catch (err) {
    console.error('Error during restoration:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
