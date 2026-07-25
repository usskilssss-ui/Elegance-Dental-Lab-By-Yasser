const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
    caseId: mongoose.Schema.Types.ObjectId,
    caseNumber: String,
    action: String,
    details: mongoose.Schema.Types.Mixed,
    timestamp: Date
  }, { collection: 'auditlogs' }));

  const logs = await AuditLog.find({ caseNumber: 'CASE-2026-00473' }).sort({ timestamp: 1 });
  console.log(`Audit logs for CASE-2026-00473:`);
  for (const log of logs) {
    console.log(`- Action: ${log.action} | Time: ${log.timestamp.toISOString()} | Details: ${JSON.stringify(log.details)}`);
  }

  await mongoose.disconnect();
}
run();
