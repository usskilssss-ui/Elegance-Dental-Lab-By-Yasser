/**
 * Inventory + COGS helpers — weighted average cost, purchase/consume/adjust.
 */
const Material = require('../models/Material');
const MaterialPurchase = require('../models/MaterialPurchase');
const MaterialStockMovement = require('../models/MaterialStockMovement');
const {
  calculateCaseCostBreakdownAsync,
  isNonBillableCase,
  parseNotesMeta,
  invalidateMaterialCache,
} = require('./casePricingService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function applyStockDelta({
  materialDoc,
  type,
  quantityDelta,
  unitCost = 0,
  refType = '',
  refId = '',
  notes = '',
  movementDate = new Date(),
  user = null,
}) {
  const mat = materialDoc;
  const prevQty = Number(mat.stockQty) || 0;
  const prevAvg = Number(mat.avgUnitCost) || 0;
  const delta = Number(quantityDelta) || 0;
  let nextQty = prevQty + delta;
  if (nextQty < 0) nextQty = 0;

  let nextAvg = prevAvg;
  let costImpact = 0;

  if (type === 'purchase' && delta > 0) {
    const buyCost = Math.max(0, Number(unitCost) || 0);
    const incoming = delta * buyCost;
    const existingValue = prevQty * prevAvg;
    nextAvg = nextQty > 0 ? (existingValue + incoming) / nextQty : buyCost;
    costImpact = round2(incoming);
  } else if (type === 'consume' && delta < 0) {
    const used = Math.abs(delta);
    costImpact = round2(used * prevAvg); // COGS
    // avg stays the same on consume
  } else if (type === 'adjust') {
    if (delta > 0 && unitCost > 0) {
      const incoming = delta * unitCost;
      const existingValue = prevQty * prevAvg;
      nextAvg = nextQty > 0 ? (existingValue + incoming) / nextQty : unitCost;
      costImpact = round2(incoming);
    } else if (delta < 0) {
      costImpact = round2(Math.abs(delta) * prevAvg);
    }
  }

  mat.stockQty = round2(nextQty);
  mat.avgUnitCost = round2(nextAvg);
  await mat.save();
  invalidateMaterialCache();

  const movement = await MaterialStockMovement.create({
    material: mat._id,
    materialKey: mat.key,
    materialLabel: mat.label,
    type,
    quantityDelta: delta,
    unitCost: round2(unitCost || prevAvg),
    costImpact,
    balanceAfter: mat.stockQty,
    avgCostAfter: mat.avgUnitCost,
    refType,
    refId: String(refId || ''),
    notes: String(notes || ''),
    movementDate: movementDate ? new Date(movementDate) : new Date(),
    createdBy: user?.id || user?._id || undefined,
    createdByName: user?.fullName || '',
  });

  return { material: mat, movement };
}

async function recordPurchase(payload, user) {
  const {
    materialId,
    quantity,
    unitCost,
    supplier = '',
    invoiceRef = '',
    purchaseDate,
    notes = '',
  } = payload || {};

  const qty = Number(quantity);
  const cost = Number(unitCost);
  if (!materialId || !(qty > 0) || !(cost >= 0) || Number.isNaN(cost)) {
    const err = new Error('بيانات الشراء غير مكتملة (الماتريال / الكمية / سعر الوحدة)');
    err.status = 400;
    throw err;
  }

  const mat = await Material.findById(materialId);
  if (!mat) {
    const err = new Error('الماتريال غير موجود');
    err.status = 404;
    throw err;
  }

  const totalCost = round2(qty * cost);
  const date = purchaseDate ? new Date(purchaseDate) : new Date();

  const purchase = await MaterialPurchase.create({
    material: mat._id,
    materialKey: mat.key,
    materialLabel: mat.label,
    quantity: qty,
    unitCost: cost,
    totalCost,
    supplier: String(supplier || '').trim(),
    invoiceRef: String(invoiceRef || '').trim(),
    purchaseDate: date,
    notes: String(notes || '').trim(),
    createdBy: user?.id || user?._id || undefined,
    createdByName: user?.fullName || '',
  });

  const { material, movement } = await applyStockDelta({
    materialDoc: mat,
    type: 'purchase',
    quantityDelta: qty,
    unitCost: cost,
    refType: 'purchase',
    refId: purchase._id,
    notes: notes || `شراء من ${supplier || '—'}`,
    movementDate: date,
    user,
  });

  return { purchase, material, movement };
}

async function adjustStock(payload, user) {
  const { materialId, quantityDelta, unitCost = 0, notes = '', movementDate } = payload || {};
  const delta = Number(quantityDelta);
  if (!materialId || !Number.isFinite(delta) || delta === 0) {
    const err = new Error('تعديل المخزون يحتاج ماتريال وكمية موجبة أو سالبة');
    err.status = 400;
    throw err;
  }
  const mat = await Material.findById(materialId);
  if (!mat) {
    const err = new Error('الماتريال غير موجود');
    err.status = 404;
    throw err;
  }
  return applyStockDelta({
    materialDoc: mat,
    type: 'adjust',
    quantityDelta: delta,
    unitCost: Number(unitCost) || 0,
    refType: 'adjust',
    refId: '',
    notes,
    movementDate: movementDate ? new Date(movementDate) : new Date(),
    user,
  });
}

/**
 * Deduct materials when a case exits (once per case). Uses billable qty lines.
 */
async function consumeCaseMaterials(dentalCase, user) {
  if (!dentalCase?._id) return null;
  if (isNonBillableCase(dentalCase.caseType, dentalCase.notes)) {
    return { skipped: true, reason: 'non-billable' };
  }

  const already = await MaterialStockMovement.findOne({
    type: 'consume',
    refType: 'case',
    refId: String(dentalCase._id),
  }).lean();
  if (already) return { skipped: true, reason: 'already-consumed', movement: already };

  const breakdown = await calculateCaseCostBreakdownAsync(
    dentalCase.caseType,
    dentalCase.notes,
    null
  );
  if (!breakdown.lines?.length) {
    return { skipped: true, reason: 'no-material-lines' };
  }

  const results = [];
  const exitDate =
    dentalCase.stageTimestamps?.exited || dentalCase.updatedAt || new Date();

  for (const line of breakdown.lines) {
    const mat = await Material.findOne({ key: line.key });
    if (!mat) continue;
    const r = await applyStockDelta({
      materialDoc: mat,
      type: 'consume',
      quantityDelta: -Math.abs(Number(line.quantity) || 0),
      unitCost: mat.avgUnitCost,
      refType: 'case',
      refId: dentalCase._id,
      notes: `استهلاك حالة ${dentalCase.caseNumber || ''}`,
      movementDate: exitDate,
      user,
    });
    results.push(r);
  }

  return { skipped: false, results };
}

module.exports = {
  round2,
  applyStockDelta,
  recordPurchase,
  adjustStock,
  consumeCaseMaterials,
};
