const CustomWorkType = require('../models/CustomWorkType');
const HiddenDefaultWorkType = require('../models/HiddenDefaultWorkType');

exports.list = async (req, res) => {
  try {
    const [items, hidden] = await Promise.all([
      CustomWorkType.find().sort({ name: 1 }).lean(),
      HiddenDefaultWorkType.find().sort({ name: 1 }).lean(),
    ]);
    res.status(200).json({
      success: true,
      data: items,
      hiddenDefaults: hidden.map((h) => h.name),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    if (name.length > 80) {
      return res.status(400).json({ success: false, message: 'name is too long' });
    }

    // Re-adding a previously hidden built-in type → unhide it
    const unhidden = await HiddenDefaultWorkType.findOneAndDelete({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (unhidden) {
      return res.status(200).json({
        success: true,
        data: { name: unhidden.name, restoredDefault: true },
        restoredDefault: true,
      });
    }

    const existing = await CustomWorkType.findOne({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (existing) {
      return res.status(200).json({ success: true, data: existing, alreadyExists: true });
    }

    const item = await CustomWorkType.create({
      name,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: 'نوع العمل موجود بالفعل' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await CustomWorkType.findByIdAndDelete(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Work type not found' });
    }
    res.status(200).json({ success: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.hideDefault = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    const existing = await HiddenDefaultWorkType.findOne({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (existing) {
      return res.status(200).json({ success: true, data: existing });
    }
    const item = await HiddenDefaultWorkType.create({
      name,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({ success: true, message: 'already hidden' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};
