/**
 * Strict case workflow rules — forward-only stages, exit only after completed.
 */

const STAGE_ORDER = [
  'waiting',
  'secretary',
  'design',
  'khart',
  'finishing',
  'completed',
  'exited',
];

function normalizeStage(stage) {
  const s = String(stage || 'waiting').trim().toLowerCase();
  return STAGE_ORDER.includes(s) ? s : 'waiting';
}

function stageIndex(stage) {
  return STAGE_ORDER.indexOf(normalizeStage(stage));
}

function isExitedCase(doc) {
  return (
    String(doc?.status || '') === 'exited' ||
    String(doc?.currentStage || '') === 'exited'
  );
}

function isCompletedCase(doc) {
  return (
    String(doc?.status || '') === 'completed' ||
    String(doc?.currentStage || '') === 'completed'
  );
}

/**
 * Allowed forward transitions for move-stage / scan.
 * - waiting/secretary ↔ each other
 * - waiting|secretary → design
 * - design → khart | finishing (khart optional in lab)
 * - khart → finishing
 * - finishing → completed
 * - completed → exited is NOT allowed here (use exitCase)
 */
function assertForwardTransition(fromRaw, toRaw) {
  const from = normalizeStage(fromRaw);
  const to = normalizeStage(toRaw);

  if (from === to) {
    return { ok: true, same: true };
  }

  if (to === 'exited') {
    return {
      ok: false,
      message: 'لا يمكن النقل المباشر إلى «خارجة» — استخدم زر/مسار الخروج بعد الإكمال',
    };
  }

  if (from === 'exited') {
    return { ok: false, message: 'الحالة خارجة ولا يمكن نقلها' };
  }

  const pairs = new Set([
    'waiting>secretary',
    'secretary>waiting',
    'waiting>design',
    'secretary>design',
    'design>khart',
    'design>finishing',
    'khart>finishing',
    'finishing>completed',
  ]);

  if (pairs.has(`${from}>${to}`)) {
    return { ok: true, same: false };
  }

  return {
    ok: false,
    message: `لا يمكن النقل من «${from}» إلى «${to}» — المراحل للأمام فقط حسب مسار المعمل`,
  };
}

/** Station scan: only advance into the station’s target from allowed prior stages */
const STATION_ALLOWED_FROM = {
  design: new Set(['waiting', 'secretary', 'design']),
  finishing: new Set(['design', 'khart', 'finishing']),
  reception: new Set(['finishing', 'completed']),
};

function assertStationTransition(station, fromRaw, targetStage) {
  const from = normalizeStage(fromRaw);
  if (from === 'exited') {
    return { ok: false, message: 'الحالة خارجة بالفعل ولا يمكن نقلها' };
  }
  const allowed = STATION_ALLOWED_FROM[station];
  if (!allowed || !allowed.has(from)) {
    return {
      ok: false,
      message: `لا يمكن مسح الحالة من مرحلة «${from}» إلى هذه المحطة`,
    };
  }
  if (from === targetStage) {
    return { ok: true, same: true };
  }
  // Must also be a valid forward edge
  return assertForwardTransition(from, targetStage);
}

function assertCanComplete(doc) {
  if (isExitedCase(doc)) {
    return { ok: false, message: 'الحالة خارجة بالفعل' };
  }
  if (isCompletedCase(doc)) {
    return { ok: true, already: true };
  }
  const stage = normalizeStage(doc?.currentStage);
  if (stage !== 'finishing' && stage !== 'completed') {
    return {
      ok: false,
      message: 'لا يمكن إكمال الحالة إلا بعد مرحلة الفينيش',
    };
  }
  return { ok: true, already: false };
}

function assertCanExit(doc) {
  if (isExitedCase(doc)) {
    return { ok: false, message: 'الحالة خارجة بالفعل' };
  }
  if (!isCompletedCase(doc)) {
    return {
      ok: false,
      message: 'لا يمكن إخراج الحالة إلا بعد أن تكون منتهية',
    };
  }
  return { ok: true };
}

module.exports = {
  STAGE_ORDER,
  normalizeStage,
  stageIndex,
  isExitedCase,
  isCompletedCase,
  assertForwardTransition,
  assertStationTransition,
  assertCanComplete,
  assertCanExit,
  STATION_ALLOWED_FROM,
};
