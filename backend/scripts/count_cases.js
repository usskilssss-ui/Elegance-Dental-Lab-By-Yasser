const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb+srv://dental-admin:Y0509749239y@cluster0.vxayme7.mongodb.net/dental-system?appName=Cluster0';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const DentalCase = mongoose.model('DentalCase', new mongoose.Schema({ currentStage: String }, { collection: 'dentalcases' }));
  
  const total = await DentalCase.countDocuments();
  const exited = await DentalCase.countDocuments({ currentStage: 'exited' });
  const completed = await DentalCase.countDocuments({ currentStage: 'completed' });
  const waiting = await DentalCase.countDocuments({ currentStage: 'waiting' });
  const other = await DentalCase.countDocuments({ currentStage: { $nin: ['waiting', 'completed', 'exited'] } });

  console.log(`إجمالي الحالات: ${total}`);
  console.log(`حالات جديدة (waiting): ${waiting}`);
  console.log(`حالات منتهية (completed): ${completed}`);
  console.log(`حالات خارجة (exited): ${exited}`);
  console.log(`مراحل أخرى (design/finishing/...): ${other}`);

  await mongoose.disconnect();
}
run();
