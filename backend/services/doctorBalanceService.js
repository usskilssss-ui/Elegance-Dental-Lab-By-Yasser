/**
 * Unified doctor balance helpers — one money rule for reports / portal / debts.
 *
 * Rule:
 * - unpaid cases: always use live DoctorPricing (same as Reports) so price edits apply
 * - paid cases: prefer exit freeze (revenueAmount / salaryAmount) so paid history stays fixed
 * - totalPaid = sum of cases marked paid + DoctorPayment ledger (payments only, not charges)
 * - remaining = max(0, totalDue - totalPaid)
 * - charges (entryType=charge) add to totalDue, never to totalPaid
 *
 * Case confirm-payment and account payments are complementary: paying the remaining
 * via ledger must not wipe earlier case-paid amounts.
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
  const totalPaid = round2(fromCases + fromPayments);
  const remaining = Math.max(0, round2(due - totalPaid));
  let paidSource = 'none';
  if (fromCases > 0 && fromPayments > 0) paidSource = 'mixed';
  else if (fromPayments > 0) paidSource = 'ledger';
  else if (fromCases > 0) paidSource = 'case-flags';
  return {
    totalDue: due,
    totalPaid,
    remaining,
    paidFromCases: fromCases,
    paidFromPayments: fromPayments,
    paidSource,
  };
}

module.exports = {
  round2,
  caseBillAmount,
  caseBillLines,
  resolveDoctorPaid,
};
