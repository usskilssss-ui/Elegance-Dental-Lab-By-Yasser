const mongoose = require('mongoose');

const materialPurchaseSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialKey: { type: String, required: true, trim: true, lowercase: true },
    materialLabel: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unitCost: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    supplier: { type: String, default: '', trim: true },
    invoiceRef: { type: String, default: '', trim: true },
    purchaseDate: { type: Date, required: true, default: Date.now },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

materialPurchaseSchema.index({ purchaseDate: -1 });
materialPurchaseSchema.index({ materialKey: 1, purchaseDate: -1 });

module.exports = mongoose.model('MaterialPurchase', materialPurchaseSchema);
