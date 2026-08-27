const User = require('../models/User');
const DentalCase = require('../models/DentalCase');
const DoctorPayment = require('../models/DoctorPayment');
const Material = require('../models/Material');
const MaterialPurchase = require('../models/MaterialPurchase');
const MaterialStockMovement = require('../models/MaterialStockMovement');
const PayrollPayment = require('../models/PayrollPayment');
const OperatingExpense = require('../models/OperatingExpense');
const {
  recordPurchase,
  adjustStock,
  round2,
} = require('../services/inventoryService');
const { isNonBillableCase } = require('../services/casePricingService');

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return null;
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start, end };
}

function yearRange(year) {
  const y = Number(year);
  if (!y) return null;
  return {
    start: new Date(y, 0, 1, 0, 0, 0, 0),
    end: new Date(y, 11, 31, 23, 59, 59, 999),
  };
}

function resolveRange(query) {
  const { year, month } = query || {};
  if (year && month) return monthRange(year, month);
  if (year) return yearRange(year);
  // default: current month
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth() + 1);
}

function caseExitDate(doc) {
  if (doc?.stageTimestamps?.exited) return new Date(doc.stageTimestamps.exited);
  return doc?.updatedAt ? new Date(doc.updatedAt) : null;
}

function computePayrollTotal(body) {
  const base = Math.max(0, Number(body.baseAmount) || 0);
  const incentive = Math.max(0, Number(body.incentiveAmount) || 0);
  const pieceUnits = Math.max(0, Number(body.pieceUnits) || 0);
  const pieceRate = Math.max(0, Number(body.pieceRate) || 0);
  const pieceAmount =
    body.pieceAmount !== undefined && body.pieceAmount !== null && body.pieceAmount !== ''
      ? Math.max(0, Number(body.pieceAmount) || 0)
      : round2(pieceUnits * pieceRate);
  const deductions = Math.max(0, Number(body.deductions) || 0);
  const totalAmount = round2(Math.max(0, base + incentive + pieceAmount - deductions));
  return { base, incentive, pieceUnits, pieceRate, pieceAmount, deductions, totalAmount };
}

const CATEGORY_LABELS = {
  rent: 'إيجار',
  utilities: 'مرافق (كهربا/مياه/نت)',
  maintenance: 'صيانة',
  delivery: 'توصيل',
  supplies: 'مستلزمات',
  other: 'أخرى',
};

// ─── Summary / Profit ─────────────────────────────────────────────

exports.getFinanceSummary = async (req, res) => {
  try {
    const range = resolveRange(req.query);
    const mode = String(req.query.mode || 'cash').toLowerCase() === 'accrual' ? 'accrual' : 'cash';
    const { start, end } = range;

    // Revenue
    let revenue = 0;
    let revenueDetail = {};

    if (mode === 'cash') {
      const payments = await DoctorPayment.find({
        paymentDate: { $gte: start, $lte: end },
      }).lean();
      revenue = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
      revenueDetail = {
        label: 'المقبوض من الأطباء (سجل الدفعات)',
        paymentsCount: payments.length,
      };
    } else {
      const cases = await DentalCase.find({ currentStage: 'exited' }).lean();
      let billed = 0;
      let count = 0;
      for (const doc of cases) {
        if (isNonBillableCase(doc.caseType, doc.notes)) continue;
        const d = caseExitDate(doc);
        if (!d || d < start || d > end) continue;
        billed += Number(doc.salaryAmount) || 0;
        count += 1;
      }
      revenue = round2(billed);
      revenueDetail = {
        label: 'إجمالي فواتير الحالات الخارجة',
        casesCount: count,
      };
    }

    // Material purchases (cash out for buying stock)
    const purchases = await MaterialPurchase.find({
      purchaseDate: { $gte: start, $lte: end },
    }).lean();
    const materialPurchasesTotal = round2(
      purchases.reduce((s, p) => s + (Number(p.totalCost) || 0), 0)
    );

    // COGS = consume movements in period
    const consumes = await MaterialStockMovement.find({
      type: 'consume',
      movementDate: { $gte: start, $lte: end },
    }).lean();
    const cogs = round2(consumes.reduce((s, m) => s + (Number(m.costImpact) || 0), 0));

    // Payroll — use month sheet totals (paid or draft count as accrued cost for that month)
    const y = start.getFullYear();
    const months =
      start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
        ? [start.getMonth() + 1]
        : Array.from({ length: 12 }, (_, i) => i + 1);

    const payrollQuery =
      months.length === 1
        ? { year: y, month: months[0] }
        : { year: y, month: { $in: months } };
    // If range is full year from resolveRange year-only, months is all 12.
    // If custom spanning years — rare; keep year of start.
    const payrollRows = await PayrollPayment.find(payrollQuery).lean();
    const payrollTotal = round2(
      payrollRows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0)
    );
    const payrollPaid = round2(
      payrollRows
        .filter((r) => r.status === 'paid')
        .reduce((s, r) => s + (Number(r.totalAmount) || 0), 0)
    );

    const expenses = await OperatingExpense.find({
      expenseDate: { $gte: start, $lte: end },
    }).lean();
    const operatingTotal = round2(
      expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    );

    // Profit views:
    // - cash-ish: revenue(cash) - purchases - payrollPaid - operating
    // - accrual-ish: revenue(billed) - cogs - payrollTotal - operating
    const expensesForProfit =
      mode === 'cash'
        ? round2(materialPurchasesTotal + payrollPaid + operatingTotal)
        : round2(cogs + payrollTotal + operatingTotal);

    const netProfit = round2(revenue - expensesForProfit);

    const inventory = await Material.find({ active: true })
      .select('key label stockQty avgUnitCost defaultPrice lowStockAlert')
      .sort({ sortOrder: 1 })
      .lean();
    const inventoryValue = round2(
      inventory.reduce(
        (s, m) => s + (Number(m.stockQty) || 0) * (Number(m.avgUnitCost) || 0),
        0
      )
    );
    const lowStock = inventory.filter(
      (m) =>
        Number(m.lowStockAlert) > 0 && Number(m.stockQty) <= Number(m.lowStockAlert)
    );

    return res.json({
      success: true,
      period: { start, end, year: req.query.year || y, month: req.query.month || null },
      mode,
      modeLabel:
        mode === 'cash'
          ? 'على المقبوض (كاش)'
          : 'على إجمالي الفواتير (محاسبي)',
      revenue,
      revenueDetail,
      costs: {
        materialPurchasesTotal,
        cogs,
        payrollTotal,
        payrollPaid,
        operatingTotal,
        expensesForProfit,
      },
      netProfit,
      inventoryValue,
      lowStockCount: lowStock.length,
      lowStock,
      explain:
        mode === 'cash'
          ? 'الربح = المقبوض − مشتريات المواد − الرواتب المدفوعة − مصاريف التشغيل'
          : 'الربح = فواتير الحالات الخارجة − تكلفة المواد المستهلكة (COGS) − رواتب الشهر − مصاريف التشغيل',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Purchases & inventory ────────────────────────────────────────

exports.listPurchases = async (req, res) => {
  try {
    const range = resolveRange(req.query);
    const q = { purchaseDate: { $gte: range.start, $lte: range.end } };
    if (req.query.materialKey) q.materialKey = String(req.query.materialKey).toLowerCase();
    const purchases = await MaterialPurchase.find(q).sort({ purchaseDate: -1 }).lean();
    return res.json({ success: true, purchases });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createPurchase = async (req, res) => {
  try {
    const result = await recordPurchase(req.body, req.user);
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.listStock = async (req, res) => {
  try {
    const materials = await Material.find({})
      .sort({ sortOrder: 1, label: 1 })
      .select('key label labelAr stockQty avgUnitCost defaultPrice lowStockAlert active color')
      .lean();
    return res.json({ success: true, materials });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.adjustStock = async (req, res) => {
  try {
    const result = await adjustStock(req.body, req.user);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.listMovements = async (req, res) => {
  try {
    const range = resolveRange(req.query);
    const q = { movementDate: { $gte: range.start, $lte: range.end } };
    if (req.query.type) q.type = req.query.type;
    if (req.query.materialKey) q.materialKey = String(req.query.materialKey).toLowerCase();
    const movements = await MaterialStockMovement.find(q).sort({ movementDate: -1 }).limit(500).lean();
    return res.json({ success: true, movements });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateMaterialStockSettings = async (req, res) => {
  try {
    const mat = await Material.findById(req.params.id);
    if (!mat) return res.status(404).json({ success: false, message: 'الماتريال غير موجود' });
    if (req.body.lowStockAlert !== undefined) {
      mat.lowStockAlert = Math.max(0, Number(req.body.lowStockAlert) || 0);
    }
    await mat.save();
    return res.json({ success: true, material: mat });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Payroll ──────────────────────────────────────────────────────

exports.listPayrollEmployees = async (req, res) => {
  try {
    const users = await User.find({
      isActive: true,
      role: { $nin: ['doctor'] },
    })
      .select('fullName role email baseSalary defaultPieceRate payType payrollEnabled')
      .sort({ fullName: 1 })
      .lean();
    return res.json({ success: true, employees: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEmployeePayroll = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    const body = req.body || {};
    if (typeof body.payrollEnabled === 'boolean') user.payrollEnabled = body.payrollEnabled;
    if (body.baseSalary !== undefined) user.baseSalary = Math.max(0, Number(body.baseSalary) || 0);
    if (body.defaultPieceRate !== undefined) {
      user.defaultPieceRate = Math.max(0, Number(body.defaultPieceRate) || 0);
    }
    if (body.payType && ['fixed', 'piece', 'mixed'].includes(body.payType)) {
      user.payType = body.payType;
    }
    await user.save();
    return res.json({
      success: true,
      employee: {
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
        baseSalary: user.baseSalary,
        defaultPieceRate: user.defaultPieceRate,
        payType: user.payType,
        payrollEnabled: user.payrollEnabled,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listPayroll = async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const rows = await PayrollPayment.find({ year, month }).sort({ employeeName: 1 }).lean();
    return res.json({ success: true, year, month, rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertPayroll = async (req, res) => {
  try {
    const body = req.body || {};
    const employeeId = body.employeeId || body.employee;
    const year = Number(body.year);
    const month = Number(body.month);
    if (!employeeId || !year || !month) {
      return res.status(400).json({ success: false, message: 'الموظف والسنة والشهر مطلوبين' });
    }
    const employee = await User.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });

    const calc = computePayrollTotal({
      baseAmount:
        body.baseAmount !== undefined ? body.baseAmount : employee.baseSalary,
      incentiveAmount: body.incentiveAmount,
      pieceUnits: body.pieceUnits,
      pieceRate:
        body.pieceRate !== undefined ? body.pieceRate : employee.defaultPieceRate,
      pieceAmount: body.pieceAmount,
      deductions: body.deductions,
    });

    const status = body.status === 'paid' ? 'paid' : 'draft';
    const update = {
      employee: employee._id,
      employeeName: employee.fullName,
      employeeRole: employee.role,
      year,
      month,
      baseAmount: calc.base,
      incentiveAmount: calc.incentive,
      pieceUnits: calc.pieceUnits,
      pieceRate: calc.pieceRate,
      pieceAmount: calc.pieceAmount,
      deductions: calc.deductions,
      totalAmount: calc.totalAmount,
      status,
      notes: String(body.notes || ''),
      createdBy: req.user.id,
      createdByName: req.user.fullName,
    };
    if (status === 'paid') {
      update.paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    } else {
      update.paidAt = undefined;
    }

    const row = await PayrollPayment.findOneAndUpdate(
      { employee: employee._id, year, month },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, row });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.generatePayrollDrafts = async (req, res) => {
  try {
    const year = Number(req.body?.year) || new Date().getFullYear();
    const month = Number(req.body?.month) || new Date().getMonth() + 1;
    const employees = await User.find({
      isActive: true,
      payrollEnabled: true,
      role: { $nin: ['doctor'] },
    });

    const created = [];
    for (const emp of employees) {
      const existing = await PayrollPayment.findOne({ employee: emp._id, year, month });
      if (existing) continue;
      const base =
        emp.payType === 'piece' ? 0 : Math.max(0, Number(emp.baseSalary) || 0);
      const pieceRate = Math.max(0, Number(emp.defaultPieceRate) || 0);
      const row = await PayrollPayment.create({
        employee: emp._id,
        employeeName: emp.fullName,
        employeeRole: emp.role,
        year,
        month,
        baseAmount: base,
        incentiveAmount: 0,
        pieceUnits: 0,
        pieceRate,
        pieceAmount: 0,
        deductions: 0,
        totalAmount: base,
        status: 'draft',
        createdBy: req.user.id,
        createdByName: req.user.fullName,
      });
      created.push(row);
    }
    return res.json({ success: true, createdCount: created.length, created });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deletePayroll = async (req, res) => {
  try {
    const row = await PayrollPayment.findByIdAndDelete(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'السجل غير موجود' });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Operating expenses ───────────────────────────────────────────

exports.listExpenses = async (req, res) => {
  try {
    const range = resolveRange(req.query);
    const q = { expenseDate: { $gte: range.start, $lte: range.end } };
    if (req.query.category) q.category = req.query.category;
    const expenses = await OperatingExpense.find(q).sort({ expenseDate: -1 }).lean();
    return res.json({
      success: true,
      expenses,
      categoryLabels: CATEGORY_LABELS,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createExpense = async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const amount = Number(body.amount);
    if (!title || !(amount >= 0) || Number.isNaN(amount)) {
      return res.status(400).json({ success: false, message: 'العنوان والمبلغ مطلوبان' });
    }
    const category = CATEGORY_LABELS[body.category] ? body.category : 'other';
    const doc = await OperatingExpense.create({
      category,
      title,
      amount: round2(amount),
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      notes: String(body.notes || '').trim(),
      createdBy: req.user.id,
      createdByName: req.user.fullName,
    });
    return res.status(201).json({ success: true, expense: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const doc = await OperatingExpense.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'المصروف غير موجود' });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.categoryLabels = CATEGORY_LABELS;
