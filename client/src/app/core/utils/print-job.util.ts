import { buildCreateCasePayload } from '../mappers/dental-case-api.mapper';

export interface PrintFormDraft {
  doctor: string;
  patient: string;
  branch: string;
  caseType: 'New' | 'Modification' | 'Redo' | 'Empty';
  workType: string;
  workDetail?: string;
  color?: string;
  quantity: number;
  date?: string;
  urgent?: boolean;
}

export function formatPrintDate(now = new Date()): string {
  return (
    now.toLocaleDateString('en-GB') +
    '  ' +
    now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  );
}

export function formatWorkTypeForPrint(wt: string): string {
  if (!wt) return '';
  if (wt === 'Empty') return 'غير معروف';
  if (wt === 'Modification') return 'تعديل';
  if (wt === 'Redo' || wt === 'Remake') return 'اعادة';
  let display = wt;
  if (display.startsWith('Modification - ')) display = display.replace('Modification - ', 'تعديل - ');
  else if (display.startsWith('Redo - ')) display = display.replace('Redo - ', 'اعادة - ');
  return display;
}

export function buildPrintData(draft: PrintFormDraft, caseNumber: string) {
  return {
    doctor: draft.doctor.trim(),
    patient: draft.patient.trim(),
    branch: (draft.branch || '').trim(),
    caseType: draft.caseType,
    workType: draft.workType.trim(),
    workDetail: (draft.workDetail || '').trim(),
    color: (draft.color || '').trim(),
    quantity: draft.caseType === 'Empty' ? 0 : draft.quantity || 1,
    caseNumber: String(caseNumber || '').trim(),
    printDate: formatPrintDate(),
    ...(draft.urgent ? { urgent: true } : {}),
  };
}

export function buildCasePayloadFromPrintForm(
  draft: PrintFormDraft,
  opts?: {
    requesterType?: 'doctor' | 'student' | 'lab';
    labName?: string;
    priority?: string;
    date?: string;
  }
) {
  const requesterType =
    opts?.requesterType === 'student'
      ? 'student'
      : opts?.requesterType === 'lab'
        ? 'lab'
        : 'doctor';
  const payload = buildCreateCasePayload({
    requesterType,
    labName: opts?.labName || (requesterType === 'lab' ? draft.doctor.trim() : ''),
    doctor: draft.doctor.trim(),
    patient: draft.patient.trim(),
    workType: draft.workType.trim(),
    workDetail: (draft.workDetail || '').trim(),
    color: (draft.color || '').trim(),
    size: '',
    branch: (draft.branch || '').trim(),
    quantity: draft.caseType === 'Empty' ? 0 : draft.quantity || 1,
    date: opts?.date || draft.date || new Date().toISOString().slice(0, 10),
  });
  if (opts?.priority) {
    payload['priority'] = opts.priority;
  } else if (draft.urgent) {
    payload['priority'] = 'urgent';
  }
  return payload;
}
