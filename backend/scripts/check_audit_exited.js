const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
    caseId: mongoose.Schema.Types.ObjectId,
    caseNumber: String,
    action: String,
    details: mongoose.Schema.Types.Mixed,
    timestamp: Date
  }, { collection: 'auditlogs' }));

  // Check audit logs for first 5 exited cases
  const caseNumbers = ['CASE-2026-00002', 'CASE-2026-00003', 'CASE-2026-00004', 'CASE-2026-00005', 'CASE-2026-00006'];
  
  for (const cn of caseNumbers) {
    const logs = await AuditLog.find({ caseNumber: cn }).sort({ timestamp: 1 });
    console.log(`\n=== ${cn} ===`);
    for (const log of logs) {
      console.log(`  Action: ${log.action} | Time: ${log.timestamp} | Details: ${JSON.stringify(log.details)}`);
    }
  }

  await mongoose.disconnect();
}
run();
