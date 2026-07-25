const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
      caseNumber: String,
      action: String,
      timestamp: Date,
      details: mongoose.Schema.Types.Mixed
    }, { collection: 'auditlogs' }));

    const count = await AuditLog.countDocuments();
    console.log(`Total AuditLogs in DB: ${count}`);

    if (count > 0) {
      console.log('Sample audit log:');
      const sample = await AuditLog.findOne().sort({ timestamp: -1 });
      console.log(JSON.stringify(sample, null, 2));
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
