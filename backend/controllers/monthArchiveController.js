const archiver = require('archiver');
const DentalCase = require('../models/DentalCase');
const User = require('../models/User');
const PrintJob = require('../models/PrintJob');
const DoctorPayment = require('../models/DoctorPayment');
const DoctorPricing = require('../models/DoctorPricing');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const MonthArchive = require('../models/MonthArchive');

function parseNotesMeta(notes) {
  const prefix = '__META__\n';
  if (!notes || typeof notes !== 'string' || !notes.startsWith(prefix)) return {};
  try {
    return JSON.parse(notes.slice(prefix.length));
  } catch {
    return {};
  }
}

function doctorNameFromCase(doc) {
  const meta = parseNotesMeta(doc.notes || '');
  return String(
    meta.doctor || meta.doctorName || (doc.assignedTo && doc.assignedTo.fullName) || 'غير محدد'
  )
    .trim()
    .replace(/\s+/g, ' ');
}

function caseExitedDate(doc) {
  if (doc?.stageTimestamps?.exited) return new Date(doc.stageTimestamps.exited);
  if (doc?.updatedAt) return new Date(doc.updatedAt);
  if (doc?.createdAt) return new Date(doc.createdAt);
  return new Date();
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')
  );
  // UTF-8 BOM for Excel Arabic
  return `\uFEFF${[header, ...lines].join('\n')}`;
}

function monthBounds(year, month) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

function inMonth(date, year, month) {
  if (!date) return false;
  const d = new Date(date);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

function classifyCaseTypeUnits(caseType, quantity) {
  const type = String(caseType || '').toLowerCase();
  const qty = Math.max(1, Number(quantity) || 1);
  const units = {
    zircon: 0,
    emax: 0,
    germanZircon: 0,
    titanium: 0,
    peek: 0,
    pmma: 0,
    nightGuard: 0,
    other: 0,
  };
  if (type.includes('german') && type.includes('zircon')) units.germanZircon += qty;
  else if (type.includes('zircon') || type.includes('زيركون')) units.zircon += qty;
  else if (type.includes('emax') || type.includes('ايماكس') || type.includes('إيماكس')) units.emax += qty;
  else if (type.includes('titanium')) units.titanium += qty;
  else if (type.includes('peek')) units.peek += qty;
  else if (type.includes('pmma')) units.pmma += qty;
  else if (type.includes('night')) units.nightGuard += qty;
  else units.other += qty;
  return units;
}

function buildSummary(cases) {
  const byTypeUnits = {
    zircon: 0,
    emax: 0,
    germanZircon: 0,
    titanium: 0,
    peek: 0,
    pmma: 0,
    nightGuard: 0,
    other: 0,
  };
  const doctorMap = {};
  let totalAmount = 0;
  let paidAmount = 0;
  let unpaidAmount = 0;
  let exitedCases = 0;

  for (const doc of cases) {
    const meta = parseNotesMeta(doc.notes || '');
    const qty = Number(meta.quantity || meta.qty || 1) || 1;
    const units = classifyCaseTypeUnits(doc.caseType, qty);
    Object.keys(units).forEach((k) => {
      byTypeUnits[k] += units[k];
    });

    const doctorName = doctorNameFromCase(doc);
    if (!doctorMap[doctorName]) {
      doctorMap[doctorName] = {
        doctorName,
        cases: 0,
        totalAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        zirconUnits: 0,
        emaxUnits: 0,
        germanZirconUnits: 0,
      };
    }
    const d = doctorMap[doctorName];
    d.cases += 1;
    d.zirconUnits += units.zircon;
    d.emaxUnits += units.emax;
    d.germanZirconUnits += units.germanZircon;

    if (doc.currentStage === 'exited') {
      exitedCases += 1;
      const amount = Number(doc.salaryAmount || 0);
      totalAmount += amount;
      d.totalAmount += amount;
      if (doc.paymentStatus === 'paid') {
        paidAmount += amount;
        d.paidAmount += amount;
      } else {
        unpaidAmount += amount;
        d.unpaidAmount += amount;
      }
    }
  }

  return {
    totalCases: cases.length,
    exitedCases,
    byDoctor: Object.values(doctorMap).sort((a, b) => b.totalAmount - a.totalAmount),
    byTypeUnits,
    totalAmount,
    paidAmount,
    unpaidAmount,
  };
}

async function loadExportPayload(year, month) {
  const filterMonth = Number.isFinite(year) && Number.isFinite(month);

  const [allCases, payments, pricings, users, printJobs, auditLogs, notifications] =
    await Promise.all([
      DentalCase.find({})
        .populate('assignedTo', 'fullName role')
        .populate('createdBy', 'fullName role')
        .sort({ createdAt: -1 })
        .lean(),
      DoctorPayment.find({}).sort({ paymentDate: -1 }).lean(),
      DoctorPricing.find({}).sort({ doctorName: 1 }).lean(),
      User.find({}).select('-password').sort({ fullName: 1 }).lean(),
      PrintJob.find({}).sort({ createdAt: -1 }).limit(5000).lean(),
      AuditLog.find({}).sort({ createdAt: -1 }).limit(10000).lean(),
      Notification.find({}).sort({ createdAt: -1 }).limit(5000).lean(),
    ]);

  let cases = allCases;
  let filteredPayments = payments;
  let filteredPrint = printJobs;
  let filteredAudit = auditLogs;
  let filteredNotif = notifications;

  if (filterMonth) {
    const { start, end } = monthBounds(year, month);
    cases = allCases.filter((doc) => {
      if (doc.currentStage === 'exited') {
        return inMonth(caseExitedDate(doc), year, month);
      }
      return inMonth(doc.createdAt, year, month);
    });
    filteredPayments = payments.filter((p) => inMonth(p.paymentDate || p.createdAt, year, month));
    filteredPrint = printJobs.filter((j) => inMonth(j.createdAt, year, month));
    filteredAudit = auditLogs.filter((a) => inMonth(a.createdAt, year, month));
    filteredNotif = notifications.filter((n) => inMonth(n.createdAt, year, month));
    // Always include full pricing + users as system settings snapshot
  }

  const caseRows = cases.map((doc) => {
    const meta = parseNotesMeta(doc.notes || '');
    return {
      id: String(doc._id),
      caseNumber: doc.caseNumber || '',
      patientName: doc.patientName || '',
      patientPhone: doc.patientPhone || '',
      patientEmail: doc.patientEmail || '',
      doctorName: doctorNameFromCase(doc),
      clinic: meta.clinic || meta.branch || '',
      caseType: doc.caseType || '',
      quantity: meta.quantity || meta.qty || '',
      color: meta.color || '',
      workType: meta.workType || '',
      currentStage: doc.currentStage || '',
      status: doc.status || '',
      requesterType: doc.requesterType || '',
      priority: doc.priority || '',
      salaryAmount: Number(doc.salaryAmount || 0),
      paymentStatus: doc.paymentStatus || 'unpaid',
      paidAt: doc.paidAt || '',
      dueDate: doc.dueDate || '',
      createdAt: doc.createdAt || '',
      exitedAt: doc.currentStage === 'exited' ? caseExitedDate(doc) : '',
      assignedTo: doc.assignedTo?.fullName || '',
      createdBy: doc.createdBy?.fullName || '',
      notesRaw: doc.notes || '',
    };
  });

  const summary = buildSummary(cases);

  return {
    year: filterMonth ? year : null,
    month: filterMonth ? month : null,
    caseRows,
    payments: filteredPayments,
    pricings,
    users,
    printJobs: filteredPrint,
    auditLogs: filteredAudit,
    notifications: filteredNotif,
    summary,
    start: filterMonth ? monthBounds(year, month).start : null,
    end: filterMonth ? monthBounds(year, month).end : null,
  };
}

exports.exportMonthData = async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : null;
    const month = req.query.month ? Number(req.query.month) : null;
    const hasMonth = Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12;

    if ((req.query.year || req.query.month) && !hasMonth) {
      return res.status(400).json({ success: false, message: 'Provide valid year and month' });
    }

    const payload = await loadExportPayload(
      hasMonth ? year : null,
      hasMonth ? month : null
    );

    const stamp = hasMonth
      ? `${year}-${String(month).padStart(2, '0')}`
      : new Date().toISOString().slice(0, 10);
    const filename = `Elegance-Lab-Export-${stamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    archive.append(
      toCsv(payload.caseRows, [
        { label: 'caseNumber', key: 'caseNumber' },
        { label: 'patientName', key: 'patientName' },
        { label: 'doctorName', key: 'doctorName' },
        { label: 'clinic', key: 'clinic' },
        { label: 'caseType', key: 'caseType' },
        { label: 'quantity', key: 'quantity' },
        { label: 'color', key: 'color' },
        { label: 'workType', key: 'workType' },
        { label: 'currentStage', key: 'currentStage' },
        { label: 'paymentStatus', key: 'paymentStatus' },
        { label: 'salaryAmount', key: 'salaryAmount' },
        { label: 'patientPhone', key: 'patientPhone' },
        { label: 'requesterType', key: 'requesterType' },
        { label: 'priority', key: 'priority' },
        { label: 'createdAt', key: 'createdAt' },
        { label: 'exitedAt', key: 'exitedAt' },
        { label: 'paidAt', key: 'paidAt' },
        { label: 'assignedTo', key: 'assignedTo' },
        { label: 'createdBy', key: 'createdBy' },
      ]),
      { name: 'cases.csv' }
    );

    archive.append(
      toCsv(payload.payments, [
        { label: 'doctorName', key: 'doctorName' },
        { label: 'amount', key: 'amount' },
        { label: 'paymentDate', key: 'paymentDate' },
        { label: 'notes', key: 'notes' },
      ]),
      { name: 'doctor_payments.csv' }
    );

    archive.append(
      toCsv(
        payload.pricings.map((p) => ({
          doctorName: p.doctorName,
          ...(p.prices || {}),
        })),
        [
          { label: 'doctorName', key: 'doctorName' },
          { label: 'emax', key: 'emax' },
          { label: 'zircon', key: 'zircon' },
          { label: 'germanZircon', key: 'germanZircon' },
          { label: 'titanium', key: 'titanium' },
          { label: 'peek', key: 'peek' },
          { label: 'pmma', key: 'pmma' },
          { label: 'nightGuard', key: 'nightGuard' },
          { label: 'mockup', key: 'mockup' },
          { label: 'wax', key: 'wax' },
          { label: 'ring', key: 'ring' },
          { label: 'tryIn', key: 'tryIn' },
        ]
      ),
      { name: 'doctor_pricing.csv' }
    );

    archive.append(
      toCsv(payload.users, [
        { label: 'fullName', key: 'fullName' },
        { label: 'email', key: 'email' },
        { label: 'phone', key: 'phone' },
        { label: 'role', key: 'role' },
        { label: 'isActive', key: 'isActive' },
        { label: 'department', key: 'department' },
      ]),
      { name: 'users.csv' }
    );

    archive.append(
      toCsv(
        payload.printJobs.map((j) => ({
          status: j.status,
          paperConfirmed: j.paperConfirmed,
          doctor: j.printData?.doctor,
          patient: j.printData?.patient,
          caseType: j.printData?.caseType,
          workType: j.printData?.workType,
          quantity: j.printData?.quantity,
          caseNumber: j.printData?.caseNumber,
          createdAt: j.createdAt,
        })),
        [
          { label: 'status', key: 'status' },
          { label: 'paperConfirmed', key: 'paperConfirmed' },
          { label: 'doctor', key: 'doctor' },
          { label: 'patient', key: 'patient' },
          { label: 'caseType', key: 'caseType' },
          { label: 'workType', key: 'workType' },
          { label: 'quantity', key: 'quantity' },
          { label: 'caseNumber', key: 'caseNumber' },
          { label: 'createdAt', key: 'createdAt' },
        ]
      ),
      { name: 'print_jobs.csv' }
    );

    archive.append(
      toCsv(payload.auditLogs, [
        { label: 'caseNumber', key: 'caseNumber' },
        { label: 'action', key: 'action' },
        { label: 'performedByName', key: 'performedByName' },
        { label: 'createdAt', key: 'createdAt' },
      ]),
      { name: 'audit_logs.csv' }
    );

    archive.append(
      toCsv(payload.notifications, [
        { label: 'type', key: 'type' },
        { label: 'title', key: 'title' },
        { label: 'message', key: 'message' },
        { label: 'caseNumber', key: 'caseNumber' },
        { label: 'createdAt', key: 'createdAt' },
      ]),
      { name: 'notifications.csv' }
    );

    archive.append(
      JSON.stringify(
        {
          year: payload.year,
          month: payload.month,
          exportedAt: new Date().toISOString(),
          ...payload.summary,
        },
        null,
        2
      ),
      { name: 'summary.json' }
    );

    // ——— Extra: dashboard-style snapshot (active cases that stay after reset) ———
    const allForDash = await DentalCase.find({}).select('currentStage status').lean();
    const dashRows = [
      { metric: 'إجمالي الحالات النشطة (غير خارجة)', value: allForDash.filter((c) => c.currentStage !== 'exited').length },
      { metric: 'الحالات الجديدة (انتظار) — فلتر الجديدة', value: allForDash.filter((c) => c.currentStage === 'waiting').length },
      { metric: 'الحالات المنتهية (قبل الخروج) — فلتر المنتهية', value: allForDash.filter((c) => c.currentStage === 'completed').length },
      { metric: 'في التصميم', value: allForDash.filter((c) => c.currentStage === 'design').length },
      { metric: 'في الخارج/الخراطة', value: allForDash.filter((c) => c.currentStage === 'khart').length },
      { metric: 'في التشطيب', value: allForDash.filter((c) => c.currentStage === 'finishing').length },
      { metric: 'سكرتارية', value: allForDash.filter((c) => c.currentStage === 'secretary').length },
      { metric: 'الحالات الخارجة (هتتمسح عند التصفير)', value: allForDash.filter((c) => c.currentStage === 'exited').length },
    ];
    archive.append(
      toCsv(dashRows, [
        { label: 'البند', key: 'metric' },
        { label: 'العدد', key: 'value' },
      ]),
      { name: 'dashboard_snapshot.csv' }
    );

    // ——— Reports-style doctor summary (exited only in export scope) ———
    const exitedRows = payload.caseRows.filter((r) => r.currentStage === 'exited');
    const reportByDoctor = Object.values(
      exitedRows.reduce((acc, row) => {
        const key = row.doctorName || 'غير محدد';
        if (!acc[key]) {
          acc[key] = {
            doctorName: key,
            cases: 0,
            totalAmount: 0,
            paidAmount: 0,
            unpaidAmount: 0,
          };
        }
        acc[key].cases += 1;
        const amount = Number(row.salaryAmount || 0);
        acc[key].totalAmount += amount;
        if (row.paymentStatus === 'paid') acc[key].paidAmount += amount;
        else acc[key].unpaidAmount += amount;
        return acc;
      }, {})
    ).sort((a, b) => b.totalAmount - a.totalAmount);

    archive.append(
      toCsv(reportByDoctor, [
        { label: 'اسم الطبيب', key: 'doctorName' },
        { label: 'عدد الحالات الخارجة', key: 'cases' },
        { label: 'إجمالي الحساب', key: 'totalAmount' },
        { label: 'المدفوع', key: 'paidAmount' },
        { label: 'المتبقي', key: 'unpaidAmount' },
      ]),
      { name: 'reports_by_doctor.csv' }
    );

    archive.append(
      toCsv(exitedRows, [
        { label: 'caseNumber', key: 'caseNumber' },
        { label: 'patientName', key: 'patientName' },
        { label: 'doctorName', key: 'doctorName' },
        { label: 'clinic', key: 'clinic' },
        { label: 'caseType', key: 'caseType' },
        { label: 'quantity', key: 'quantity' },
        { label: 'color', key: 'color' },
        { label: 'workType', key: 'workType' },
        { label: 'paymentStatus', key: 'paymentStatus' },
        { label: 'salaryAmount', key: 'salaryAmount' },
        { label: 'createdAt', key: 'createdAt' },
        { label: 'exitedAt', key: 'exitedAt' },
        { label: 'paidAt', key: 'paidAt' },
        { label: 'createdBy', key: 'createdBy' },
      ]),
      { name: 'exited_cases_all.csv' }
    );

    // ——— One Excel-friendly CSV per doctor (exited cases only) ———
    const byDoctorCases = exitedRows.reduce((acc, row) => {
      const key = row.doctorName || 'غير محدد';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});

    const safeName = (name) =>
      String(name || 'unknown')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80);

    for (const [doctorName, rows] of Object.entries(byDoctorCases)) {
      const total = rows.reduce((s, r) => s + Number(r.salaryAmount || 0), 0);
      const paid = rows
        .filter((r) => r.paymentStatus === 'paid')
        .reduce((s, r) => s + Number(r.salaryAmount || 0), 0);
      archive.append(
        toCsv(rows, [
          { label: 'رقم الحالة', key: 'caseNumber' },
          { label: 'المريض', key: 'patientName' },
          { label: 'النوع', key: 'caseType' },
          { label: 'الكمية', key: 'quantity' },
          { label: 'اللون', key: 'color' },
          { label: 'نوع العمل', key: 'workType' },
          { label: 'المبلغ', key: 'salaryAmount' },
          { label: 'حالة الدفع', key: 'paymentStatus' },
          { label: 'تاريخ الدخول', key: 'createdAt' },
          { label: 'تاريخ الخروج', key: 'exitedAt' },
          { label: 'الفرع', key: 'clinic' },
        ]),
        { name: `doctors/${safeName(doctorName)}.csv` }
      );
      archive.append(
        JSON.stringify(
          {
            doctorName,
            exitedCases: rows.length,
            totalAmount: total,
            paidAmount: paid,
            unpaidAmount: total - paid,
          },
          null,
          2
        ),
        { name: `doctors/${safeName(doctorName)}_summary.json` }
      );
    }

    if (hasMonth) {
      await MonthArchive.findOneAndUpdate(
        { year, month },
        {
          $set: {
            exportedAt: new Date(),
            summary: {
              ...payload.summary,
              activeCasesKept: 0,
              deletedExitedCases: 0,
              deletedPayments: 0,
            },
          },
        },
        { upsert: true, new: true }
      );
    }

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to export data',
        error: error.message,
      });
    }
  }
};

exports.listArchives = async (_req, res) => {
  try {
    const rows = await MonthArchive.find({}).sort({ year: -1, month: -1 }).lean();
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to list archives',
      error: error.message,
    });
  }
};

exports.closeMonth = async (req, res) => {
  try {
    const year = Number(req.body.year);
    const month = Number(req.body.month);
    const confirm = String(req.body.confirm || '').trim();
    const force = Boolean(req.body.force);

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'Valid year and month are required' });
    }

    const expected = `${year}-${String(month).padStart(2, '0')}`;
    if (confirm !== expected) {
      return res.status(400).json({
        success: false,
        message: `اكتب للتأكيد: ${expected}`,
      });
    }

    const existing = await MonthArchive.findOne({ year, month });
    if (existing?.closedAt && !force) {
      return res.status(409).json({
        success: false,
        message: 'هذا الشهر مقفول بالفعل. أرسل force=true للإعادة.',
      });
    }

    if (!existing?.exportedAt && !force) {
      return res.status(400).json({
        success: false,
        message: 'حمّل بيانات الشهر أولاً قبل الإغلاق، أو أرسل force=true',
      });
    }

    // Snapshot ALL current data for summary before wipe of exited
    const allCases = await DentalCase.find({})
      .populate('assignedTo', 'fullName')
      .lean();
    const monthCases = allCases.filter((doc) => {
      if (doc.currentStage === 'exited') return inMonth(caseExitedDate(doc), year, month);
      return inMonth(doc.createdAt, year, month);
    });
    const summary = buildSummary(monthCases);

    const exitedIds = allCases
      .filter((doc) => doc.currentStage === 'exited')
      .map((doc) => doc._id);

    const activeKept = allCases.filter((doc) => doc.currentStage !== 'exited').length;

    const deleteCasesResult = await DentalCase.deleteMany({
      _id: { $in: exitedIds },
    });

    // Wipe all doctor payments (full ledger reset with month close)
    const deletePaymentsResult = await DoctorPayment.deleteMany({});

    if (exitedIds.length) {
      await AuditLog.deleteMany({ caseId: { $in: exitedIds } });
      await Notification.deleteMany({ caseId: { $in: exitedIds } });
    }

    // Clear print queue noise
    await PrintJob.deleteMany({});

    const archive = await MonthArchive.findOneAndUpdate(
      { year, month },
      {
        $set: {
          closedAt: new Date(),
          closedBy: req.user.id,
          confirmPhrase: confirm,
          summary: {
            ...summary,
            activeCasesKept: activeKept,
            deletedExitedCases: deleteCasesResult.deletedCount || 0,
            deletedPayments: deletePaymentsResult.deletedCount || 0,
          },
        },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'تم إغلاق الشهر وتصفير الحالات الخارجة',
      data: {
        year,
        month,
        deletedExitedCases: deleteCasesResult.deletedCount || 0,
        deletedPayments: deletePaymentsResult.deletedCount || 0,
        activeCasesKept: activeKept,
        archive,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to close month',
      error: error.message,
    });
  }
};
