/**
 * Unified doctor balance helpers — one money rule for reports / portal / debts.
 *
 * Rule:
 * - unpaid cases: always use live DoctorPricing (same as Reports) so price edits apply
 * - paid cases: prefer exit freeze (revenueAmount / salaryAmount) so paid history stays fixed
 * - totalPaid = DoctorPayment ledger if any payments exist for doctor; else sum of cases marked paid
 * - remaining = max(0, totalDue - totalPaid)
 *
 * Never add case-paid flags AND payment ledger together (that double-counts).
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isCasePaid(doc) {
  return String(doc?.paymentStatus || 'unpaid') === 'paid';
}

/**
 * Bill amount for a case.
 * Unpaid → live price (Reports-aligned). Paid → frozen snapshot when present.
 */
function caseBillAmount(doc, liveBreakdownTotal) {
  const live = round2(liveBreakdownTotal || 0);
  if (!isCasePaid(doc) && live > 0) return live;
  const snapshot = Number(doc?.revenueAmount ?? doc?.salaryAmount ?? 0);
  if (Number.isFinite(snapshot) && snapshot > 0) return round2(snapshot);
  return live;
}

/**
 * Prefer frozen bill lines only for paid cases; unpaid always show live unit prices.
 */
function caseBillLines(doc, liveBreakdown) {
  const liveLines = Array.isArray(liveBreakdown?.lines) ? liveBreakdown.lines : [];
  const liveUnit = Number(liveBreakdown?.unitPrice) || 0;
  if (
    isCasePaid(doc) &&
    doc?.billSnapshot &&
    Array.isArray(doc.billSnapshot.lines) &&
    doc.billSnapshot.lines.length
  ) {
    return {
      lines: doc.billSnapshot.lines,
      unitPrice:
        doc.billSnapshot.unitPrice != null ? Number(doc.billSnapshot.unitPrice) || liveUnit : liveUnit,
    };
  }
  return { lines: liveLines, unitPrice: liveUnit };
}

/**
 * @param {object} opts
 * @param {number} opts.totalDue
 * @param {number} opts.paidFromCases - sum of bill amounts for cases with paymentStatus=paid
 * @param {number} opts.paidFromPayments - sum of DoctorPayment.amount
 */
function resolveDoctorPaid({ totalDue, paidFromCases, paidFromPayments }) {
  const due = round2(totalDue);
  const fromCases = round2(paidFromCases);
  const fromPayments = round2(paidFromPayments);
  const totalPaid = fromPayments > 0 ? fromPayments : fromCases;
  const remaining = Math.max(0, round2(due - totalPaid));
  return {
    totalDue: due,
    totalPaid,
    remaining,
    paidFromCases: fromCases,
    paidFromPayments: fromPayments,
    paidSource: fromPayments > 0 ? 'ledger' : 'case-flags',
  };
}

module.exports = {
  round2,
  caseBillAmount,
  caseBillLines,
  resolveDoctorPaid,
};
