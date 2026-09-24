const CLIENT_PORTAL_ROLES = ['doctor', 'student', 'lab'];

function isClientPortalRole(role) {
  return CLIENT_PORTAL_ROLES.includes(String(role || '').toLowerCase());
}

function requesterTypeForRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'student') return 'student';
  if (r === 'lab') return 'lab';
  return 'doctor';
}

function departmentForClientRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'student') return 'طالب';
  if (r === 'lab') return 'معمل';
  return 'دكتور';
}

function normalizeClientRole(role) {
  const r = String(role || '').toLowerCase();
  return CLIENT_PORTAL_ROLES.includes(r) ? r : 'doctor';
}

module.exports = {
  CLIENT_PORTAL_ROLES,
  isClientPortalRole,
  requesterTypeForRole,
  departmentForClientRole,
  normalizeClientRole,
};
