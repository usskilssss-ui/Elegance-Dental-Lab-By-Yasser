/**
 * Prefer Arabic workflow messages from the API body.
 */
export function formatCaseWorkflowError(
  err: unknown,
  fallback = 'تعذر تنفيذ العملية — تحقق من حالة الحالة والاتصال'
): string {
  const anyErr = err as {
    error?: { message?: string; error?: string; errors?: { msg?: string }[] };
    status?: number;
    message?: string;
  };

  const body = anyErr?.error;
  const msg = body?.message;
  if (typeof msg === 'string' && msg.trim()) {
    return msg.trim();
  }

  const detail = body?.error;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }

  const errs = body?.errors;
  if (Array.isArray(errs) && errs[0]?.msg) {
    return String(errs[0].msg);
  }

  if (anyErr?.status === 401) return 'يجب تسجيل الدخول أولًا';
  if (anyErr?.status === 403) return 'ليس لديك صلاحية لهذه العملية';
  if (anyErr?.status === 404) return 'الحالة غير موجودة';

  if (typeof anyErr?.message === 'string' && anyErr.message && !/Http failure/i.test(anyErr.message)) {
    return anyErr.message;
  }

  return fallback;
}
