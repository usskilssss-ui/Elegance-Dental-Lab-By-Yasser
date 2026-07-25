const mongoose = require('mongoose');
const DentalCase = require('../models/DentalCase');
const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  
  // Find an exited case
  const c = await DentalCase.findOne({ currentStage: 'exited' });
  if (!c) {
    console.log('No exited case found');
    process.exit(0);
  }

  console.log('Original exited date:', c.stageTimestamps?.exited);
  
  // Try to update using the same logic as controller
  const stageTimestamps = { exited: '2026-08-01T12:00:00.000Z' };
  
  if (!c.stageTimestamps) {
    c.stageTimestamps = {};
  }
  for (const [key, val] of Object.entries(stageTimestamps)) {
    c.stageTimestamps[key] = val ? new Date(String(val)) : null;
  }
  c.markModified('stageTimestamps');
  
  await c.save();
  
  // Fetch again to verify
  const updated = await DentalCase.findById(c._id);
  console.log('Updated exited date:', updated.stageTimestamps?.exited);
  
  process.exit(0);
}

run().catch(console.error);
