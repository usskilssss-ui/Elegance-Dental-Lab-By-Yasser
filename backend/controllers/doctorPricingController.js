const DoctorPricing = require('../models/DoctorPricing');
const {
  doctorKeysMatch,
  normalizeDoctorKey,
  repriceUnpaidExitedCasesForDoctor,
} = require('../services/casePricingService');

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
        // Store both original + lowercase so Material.key (lowercased by mongoose)
        // and legacy camelCase DoctorPricing rows both resolve.
        cleanedPrices[key] = n;
        cleanedPrices[String(key).toLowerCase()] = n;
      }
    }

    // Upsert canonical row, then sync any name-variant rows so live lookup
    // never keeps an older germanZircon=850 under "د. فرزات" while UI saved "فرزات".
    let pricing = await DoctorPricing.findOne({ doctorName: normalizedName });
    if (pricing) {
      pricing.prices = { ...pricing.prices, ...cleanedPrices };
      await pricing.save();
    } else {
      pricing = await DoctorPricing.create({
        doctorName: normalizedName,
        prices: cleanedPrices,
      });
    }

    const all = await DoctorPricing.find();
    const wantKey = normalizeDoctorKey(normalizedName);
    for (const row of all) {
      if (String(row._id) === String(pricing._id)) continue;
      const same =
        doctorKeysMatch(row.doctorName, normalizedName) ||
        (wantKey && normalizeDoctorKey(row.doctorName) === wantKey);
      if (!same) continue;
      row.prices = { ...(row.prices || {}), ...cleanedPrices };
      await row.save();
    }

    // Actually recalculate unpaid exited bills so Doctor Accounts matches Reports.
    let recalculated = 0;
    try {
      const result = await repriceUnpaidExitedCasesForDoctor(
        normalizedName,
        pricing.prices || cleanedPrices
      );
      recalculated = Number(result?.updated) || 0;
    } catch (repriceErr) {
      console.warn(
        '[doctor-pricing] reprice unpaid failed:',
        normalizedName,
        repriceErr?.message || repriceErr
      );
    }

    res.status(200).json({
      success: true,
      data: pricing,
      recalculated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
