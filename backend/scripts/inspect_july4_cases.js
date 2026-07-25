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
      notes: String,
      currentStage: String
    }, { collection: 'dentalcases' }));

    const cases = await DentalCase.find({ currentStage: { $in: ['completed', 'exited'] } });
    
    let countJuly4 = 0;
    let otherCount = 0;

    const july4Cases = [];

    for (const c of cases) {
      let meta = {};
      if (c.notes && c.notes.startsWith('__META__\n')) {
        try {
          meta = JSON.parse(c.notes.slice('__META__\n'.length));
        } catch (e) {}
      }
      
      const rDateStr = meta.receivedDate;
      if (rDateStr) {
        // Standard formats: "2026-07-04 ...", "7/4/2026 ...", "04-07-2026 ...", etc.
        // Let's parse with Date to check if it corresponds to 4 July 2026
        const parsedDate = new Date(rDateStr);
        const isValid = !isNaN(parsedDate.getTime());
        
        let isJuly4 = false;
        if (isValid) {
          // Check year = 2026, month = 6 (0-indexed July is 6), day = 4
          isJuly4 = parsedDate.getFullYear() === 2026 && parsedDate.getMonth() === 6 && parsedDate.getDate() === 4;
        } else {
          // Text-based fallback check
          isJuly4 = rDateStr.includes('2026-07-04') || rDateStr.includes('04-07-2026') || rDateStr.includes('4-7-2026') || rDateStr.includes('7/4/2026');
        }

        if (isJuly4) {
          countJuly4++;
          july4Cases.push({
            caseNumber: c.caseNumber,
            patientName: c.patientName,
            receivedDate: rDateStr
          });
        } else {
          otherCount++;
        }
      } else {
        otherCount++;
      }
    }

    console.log(`\nFinished cases with received date July 4, 2026: ${countJuly4}`);
    console.log(`Finished cases with other received dates: ${otherCount}`);
    console.log(`Total finished cases: ${cases.length}`);
    console.log('\nJuly 4 Cases List:');
    console.log(JSON.stringify(july4Cases, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

run();
