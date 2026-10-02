/**
 * Unified doctor balance helpers — one money rule for reports / portal / debts.
 *
 * Bill amount:
 * - Exited cases with a freeze (revenueAmount / billSnapshot / salaryAmount) → use freeze
 * - Otherwise unpaid preview may use live DoctorPricing
 *
 * Paid amount (no double-count):
 * - paidFromCases = sum of bills for cases with paymentStatus=paid
 * - paidFromPayments = sum of DoctorPayment ledger rows that are NOT linked to a case
 *   (case-linked ledger rows are settlement records for already-counted case flags)
 * - totalPaid = min(totalDue, paidFromCases + paidFromPayments)
 * - charges (entryType=charge) add to totalDue, never to totalPaid
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isCasePaid(doc) {
  return String(doc?.paymentStatus || 'unpaid') === 'paid';
}

/** Canonical frozen doctor bill for an exited case. */
function frozenBillAmount(doc) {
  const revenue = Number(doc?.revenueAmount);
  if (Number.isFinite(revenue) && revenue > 0) return round2(revenue);
  const snap = Number(doc?.billSnapshot?.total);
  if (Number.isFinite(snap) && snap > 0) return round2(snap);
  const salary = Number(doc?.salaryAmount);
  if (Number.isFinite(salary) && salary > 0) return round2(salary);
  return 0;
}

/**
 * Bill amount for a case.
 * Prefer freeze whenever present (especially after exit); live only as fallback preview.
 */
function caseBillAmount(doc, liveBreakdownTotal) {
  const frozen = frozenBillAmount(doc);
  if (frozen > 0) return frozen;
  const live = round2(liveBreakdownTotal || 0);
  if (live > 0) return live;
  return 0;
}

/**
 * Prefer frozen bill lines when snapshot exists; otherwise live unit prices.
 */
function caseBillLines(doc, liveBreakdown) {
  const liveLines = Array.isArray(liveBreakdown?.lines) ? liveBreakdown.lines : [];
  const liveUnit = Number(liveBreakdown?.unitPrice) || 0;
  if (
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
 * @param {number} opts.paidFromPayments - sum of UNLINKED DoctorPayment.amount (payments only)
 */
function resolveDoctorPaid({ totalDue, paidFromCases, paidFromPayments }) {
  const due = round2(totalDue);
  const fromCases = round2(paidFromCases);
  const fromPayments = round2(paidFromPayments);
  // Cap at due so case-flag + duplicate ledger never invents overpayment that hides issues weirdly
  const totalPaid = round2(Math.min(due, fromCases + fromPayments));
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

/** True if a ledger payment should count toward cash-in (not already covered by case paid flag). */
function isUnallocatedPayment(entry) {
  if (!entry) return false;
  if (String(entry.entryType || 'payment') === 'charge') return false;
  if (entry.caseId) return false;
  return true;
}

module.exports = {
  round2,
  frozenBillAmount,
  caseBillAmount,
  caseBillLines,
  resolveDoctorPaid,
  isUnallocatedPayment,
  isCasePaid,
};
