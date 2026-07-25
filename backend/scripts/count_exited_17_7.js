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
      stageTimestamps: {
        exited: Date
      }
    }, { collection: 'dentalcases' }));

    console.log('Querying cases exited on July 17, 2026...');
    
    const exitedCases = await DentalCase.find({ currentStage: 'exited' });
    console.log(`Total exited cases in DB: ${exitedCases.length}`);

    let countUtc = 0;
    let countLocal = 0;
    
    // We are in local timezone UTC+3.
    // 17 July 2026 local time is:
    // Starts: 2026-07-16T21:00:00.000Z
    // Ends:   2026-07-17T21:00:00.000Z
    const localStart = new Date('2026-07-16T21:00:00.000Z');
    const localEnd = new Date('2026-07-17T21:00:00.000Z');
    
    const utcStart = new Date('2026-07-17T00:00:00.000Z');
    const utcEnd = new Date('2026-07-17T23:59:59.999Z');

    const matchingCases = [];

    for (const c of exitedCases) {
      const exitDate = c.stageTimestamps && c.stageTimestamps.exited;
      if (exitDate) {
        const exitTime = exitDate.getTime();
        
        const isUtc = exitTime >= utcStart.getTime() && exitTime <= utcEnd.getTime();
        const isLocal = exitTime >= localStart.getTime() && exitTime <= localEnd.getTime();

        if (isUtc) countUtc++;
        if (isLocal) countLocal++;

        if (isLocal || isUtc) {
          matchingCases.push({
            caseNumber: c.caseNumber,
            patientName: c.patientName,
            exitedAt: exitDate.toISOString(),
            exitedAtLocal: new Date(exitTime + 3 * 60 * 60 * 1000).toISOString().replace('Z', ' +03:00')
          });
        }
      }
    }

    console.log(`\nResults:`);
    console.log(`- Count by UTC day (July 17): ${countUtc}`);
    console.log(`- Count by Local day (UTC+3, July 17): ${countLocal}`);
    console.log(`\nMatching Cases details:`);
    console.log(JSON.stringify(matchingCases, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
