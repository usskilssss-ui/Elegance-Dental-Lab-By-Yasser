/**
 * Unified doctor balance helpers — one money rule for reports / portal / debts.
 *
 * Rule:
 * - totalDue = sum of case bill amounts (prefer exit snapshot, else live price)
 * - totalPaid = DoctorPayment ledger if any payments exist for doctor; else sum of cases marked paid
 * - remaining = max(0, totalDue - totalPaid)
 *
 * Never add case-paid flags AND payment ledger together (that double-counts).
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function caseBillAmount(doc, liveBreakdownTotal) {
  const snapshot = Number(doc?.revenueAmount ?? doc?.salaryAmount ?? 0);
  if (Number.isFinite(snapshot) && snapshot > 0) return round2(snapshot);
  return round2(liveBreakdownTotal || 0);
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
  resolveDoctorPaid,
};
