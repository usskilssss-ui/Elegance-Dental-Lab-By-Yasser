export type ClientAccountKind = 'doctor' | 'student' | 'lab';

export const CLIENT_ACCOUNT_KINDS: ClientAccountKind[] = ['doctor', 'student', 'lab'];

export function isClientAccountKind(role: string | undefined | null): role is ClientAccountKind {
  const v = String(role || '').toLowerCase();
  return v === 'doctor' || v === 'student' || v === 'lab';
}

export function normalizeClientAccountKind(role: string | undefined | null): ClientAccountKind {
  return isClientAccountKind(role) ? role : 'doctor';
}
