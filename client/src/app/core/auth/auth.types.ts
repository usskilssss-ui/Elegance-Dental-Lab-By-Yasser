/** Canonical roles stored on the session after login (from staff account). */
export type AppRole =
  | 'admin'
  | 'secretary'
  | 'designer'
  | 'finisher'
  | 'requester'
  | 'doctor'
  | 'scanner1'
  | 'scanner2'
  | 'scanner3';

export interface AuthSession {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  loginAt: string;
  hasPin?: boolean;
}
