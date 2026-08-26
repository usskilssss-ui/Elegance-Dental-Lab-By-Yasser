const DoctorPricing = require('../models/DoctorPricing');

exports.getAllPricings = async (req, res) => {
  try {
    const pricings = await DoctorPricing.find();
    res.status(200).json({ success: true, data: pricings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePricing = async (req, res) => {
  try {
    const { doctorName, prices } = req.body;
    if (!doctorName) {
      return res.status(400).json({ success: false, message: 'doctorName is required' });
    }

    const normalizedName = doctorName.trim();
    const cleanedPrices = {};
    if (prices && typeof prices === 'object') {
      for (const [key, val] of Object.entries(prices)) {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({
            success: false,
            message: `السعر «${key}» يجب أن يكون رقمًا ≥ 0`,
          });
        }
        cleanedPrices[key] = n;
      }
    }

    let pricing = await DoctorPricing.findOne({ doctorName: normalizedName });
    if (pricing) {
      pricing.prices = { ...pricing.prices, ...cleanedPrices };
      await pricing.save();
    } else {
      pricing = await DoctorPricing.create({
        doctorName: normalizedName,
        prices: cleanedPrices
      });
    }

    res.status(200).json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
