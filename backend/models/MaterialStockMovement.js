const mongoose = require('mongoose');

const materialStockMovementSchema = new mongoose.Schema(
  {
    material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialKey: { type: String, required: true, trim: true, lowercase: true },
    materialLabel: { type: String, default: '', trim: true },
    /** purchase | consume | adjust */
    type: {
      type: String,
      enum: ['purchase', 'consume', 'adjust'],
      required: true,
    },
    /** Signed delta: +in / −out */
    quantityDelta: { type: Number, required: true },
    unitCost: { type: Number, default: 0, min: 0 },
    /** Cost impact for period reports (purchases +, consumes as COGS +, adjusts variable) */
    costImpact: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    avgCostAfter: { type: Number, default: 0 },
    refType: { type: String, default: '', trim: true },
    refId: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    movementDate: { type: Date, required: true, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

materialStockMovementSchema.index({ movementDate: -1 });
materialStockMovementSchema.index({ materialKey: 1, movementDate: -1 });
materialStockMovementSchema.index({ type: 1, refType: 1, refId: 1 });

module.exports = mongoose.model('MaterialStockMovement', materialStockMovementSchema);
