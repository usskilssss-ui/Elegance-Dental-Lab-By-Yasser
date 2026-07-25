const mongoose = require('mongoose');
const DoctorPricing = require('./models/DoctorPricing');
require('dotenv').config();

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');

  try {
    const doctorName = 'Test Doctor';
    const prices = { zircon: 600, mockup: 150 };

    let pricing = await DoctorPricing.findOne({ doctorName });
    if (pricing) {
      pricing.prices = { ...pricing.prices, ...prices };
      await pricing.save();
      console.log('Updated existing');
    } else {
      pricing = await DoctorPricing.create({
        doctorName,
        prices
      });
      console.log('Created new');
    }
    console.log(pricing);
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit();
}
test();
