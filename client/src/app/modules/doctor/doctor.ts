import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { SharedCasesService, DentalCase } from '../../core/services/shared-cases.service';
import { mapApiCaseToDentalCase } from '../../core/mappers/dental-case-api.mapper';
import {
  buildCasePayloadFromPrintForm,
  buildPrintData,
  formatWorkTypeForPrint,
} from '../../core/utils/print-job.util';
import { SocketService } from '../../core/services/socket.service';
import { ThemeService } from '../../core/services/theme.service';
import { PwaInstallService } from '../../core/services/pwa-install.service';
import { environment } from '../../../environments/environment';
import { PatientLabelPipe } from '../secretary/patient-label.pipe';

function todayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function emptyDraft() {
  return {
    caseNumber: '',
    patient: '',
    workType: '',
    workDetail: '',
    color: '',
    branch: '',
    quantity: 1,
    date: todayYmd(),
    caseType: 'New' as 'New' | 'Modification' | 'Redo' | 'Empty',
    urgent: false,
  };
}

type DoctorStage = 'pending' | 'design' | 'finishing' | 'finished' | 'exited';

type DoctorFilter = 'all' | 'important' | DoctorStage;

export type DoctorNotif = {
  id: string;
  caseId: string;
  caseNumber: string;
  patient: string;
  kind: 'finished' | 'exited';
  message: string;
  at: number;
  read: boolean;
};

@Component({
  selector: 'app-doctor',
  standalone: true,
  imports: [CommonModule, FormsModule, PatientLabelPipe],
  templateUrl: './doctor.html',
  styleUrls: ['../secretary/secretary.css', './doctor.css'],
})
export class DoctorComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly caseApi = inject(CaseApiService);
  private readonly sharedCases = inject(SharedCasesService);
  private readonly socketService = inject(SocketService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  public readonly themeService = inject(ThemeService);
  public readonly pwa = inject(PwaInstallService);

  private readonly apiBase = environment.apiUrl;
  private readonly socketSubs: Subscription[] = [];
  private knownStatus = new Map<string, DoctorStage>();
  private notifHydrated = false;

  /** Admin viewing a specific doctor's portal via ?as=Name */
  readonly viewingAsDoctor = signal<string | null>(null);
  readonly isAdminView = computed(() => {
    const role = this.auth.getSession()?.role;
    return role === 'admin' && !!this.viewingAsDoctor();
  });
  readonly doctorName = computed(() => {
    const as = this.viewingAsDoctor()?.trim();
    if (as && this.auth.getSession()?.role === 'admin') return as;
    return this.auth.getSession()?.name?.trim() || '—';
  });
  readonly casesLoading = signal(true);
  readonly toast = signal<string | null>(null);
  readonly dialogOpen = signal(false);
  readonly dialogMode = signal<'create' | 'edit'>('create');
  readonly detailOpen = signal(false);
  readonly detailCase = signal<DentalCase | null>(null);
  readonly notificationsOpen = signal(false);
  readonly notifications = signal<DoctorNotif[]>([]);
  readonly saveInProgress = signal(false);
  readonly activeFilter = signal<DoctorFilter>('all');
  readonly searchQuery = signal('');

  editingId: string | null = null;
  formDraft = emptyDraft();
  patientNameError = '';

  readonly workTypeOptions = [
    'Zircon',
    'Emax',
    'Pmma Cad',
    'Peek',
    'Titanium',
    'Try in',
    'Mokup',
    'Night Guard',
    'Wax',
    'Ring',
  ];

  readonly caseTypeOptions = [
    { value: 'New', label: 'جديد' },
    { value: 'Modification', label: 'تعديل' },
    { value: 'Redo', label: 'اعادة' },
    { value: 'Empty', label: 'غير معروف' },
  ];

  selectedWorkTypes = new Set<string>();
  workTypeQuantities: Record<string, number> = {};
  nightGuardType: 'Soft' | 'Hard' | '' = '';
  workTypeError = '';

  readonly colorRequiredTypes = new Set(['Zircon', 'Emax', 'Peek', 'Titanium']);

  get isColorRequired(): boolean {
    if (this.formDraft.caseType === 'Empty') return false;
    for (const wt of this.selectedWorkTypes) {
      if (this.colorRequiredTypes.has(wt)) return true;
    }
    return false;
  }

  get searchQueryValue(): string {
    return this.searchQuery();
  }
  set searchQueryValue(v: string) {
    this.searchQuery.set(v);
  }

  readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length
  );

  private bucket(c: DentalCase): DoctorStage {
    if (c.status === 'exited') return 'exited';
    const stage = String(c.currentStage || '').toLowerCase();
    if (stage === 'finishing' || c.status === 'ready-for-finishing') return 'finishing';
    if (c.status === 'finished' || stage === 'completed') return 'finished';
    if (c.status === 'in-progress' || c.status === 'under-khart' || c.status === 'needs-revision') {
      return 'design';
    }
    return 'pending';
  }

  canEdit(c: DentalCase): boolean {
    return this.bucket(c) === 'pending';
  }

  isImportant(c: DentalCase | string): boolean {
    if (typeof c === 'string') {
      const found = this.allCases().find((x) => x.id === c);
      return found?.priority === 'emergency';
    }
    return c.priority === 'emergency';
  }

  toggleImportant(c: DentalCase, ev?: Event): void {
    ev?.stopPropagation();
    const makeUrgent = c.priority !== 'emergency';
    const prev = c.priority;
    const optimistic: DentalCase = {
      ...c,
      priority: makeUrgent ? 'emergency' : 'normal',
    };
    this.sharedCases.updateCase(c.id, optimistic);
    if (this.detailCase()?.id === c.id) {
      this.detailCase.set(optimistic);
    }
    this.caseApi.updateCase(c.id, { priority: makeUrgent ? 'urgent' : 'normal' }).subscribe({
      next: () => {
        this.flash(
          makeUrgent
            ? '✅ تم تمييز الحالة كمستعجلة — هتظهر للسكرتارية'
            : 'تم إلغاء تمييز الاستعجال'
        );
      },
      error: (err) => {
        this.sharedCases.updateCase(c.id, { ...c, priority: prev });
        if (this.detailCase()?.id === c.id) {
          this.detailCase.set({ ...c, priority: prev });
        }
        this.flash(err?.error?.message || 'تعذر تحديث الأولوية');
      },
    });
  }

  readonly allCases = computed(() => {
    const name = this.doctorName();
    const rows = this.sharedCases.cases();
    if (!name || name === '—') return rows;
    const key = this.normalizeDoctorKey(name);
    return rows.filter((c) => this.normalizeDoctorKey(c.doctor || '') === key);
  });

  readonly stats = computed(() => {
    const all = this.allCases();
    const pending = all.filter((c) => this.bucket(c) === 'pending').length;
    const design = all.filter((c) => this.bucket(c) === 'design').length;
    const finishing = all.filter((c) => this.bucket(c) === 'finishing').length;
    const finished = all.filter((c) => this.bucket(c) === 'finished').length;
    const exited = all.filter((c) => this.bucket(c) === 'exited').length;
    return [
      { label: 'إجمالي الحالات', value: all.length, color: 'purple' as const },
      { label: 'الحالات الجديدة', value: pending, color: 'amber' as const },
      { label: 'تحت الديزاين', value: design, color: 'blue' as const },
      { label: 'تحت الفينيش', value: finishing, color: 'teal' as const },
      { label: 'الحالات المنتهية', value: finished, color: 'emerald' as const },
      { label: 'الحالات الخارجة', value: exited, color: 'rose' as const },
    ];
  });

  readonly filterCounts = computed(() => {
    const all = this.allCases();
    const active = all.filter((c) => c.status !== 'exited');
    const important = active.filter((c) => c.priority === 'emergency').length;
    return {
      all: active.length,
      important,
      pending: all.filter((c) => this.bucket(c) === 'pending').length,
      design: all.filter((c) => this.bucket(c) === 'design').length,
      finishing: all.filter((c) => this.bucket(c) === 'finishing').length,
      finished: all.filter((c) => this.bucket(c) === 'finished').length,
      exited: all.filter((c) => this.bucket(c) === 'exited').length,
    };
  });

  readonly cases = computed(() => {
    const q = this.normalizeSearch(this.searchQuery());
    const filter = this.activeFilter();
    let list = this.allCases();
    if (filter === 'important') {
      list = list.filter((c) => c.status !== 'exited' && c.priority === 'emergency');
    } else if (filter === 'all') {
      list = list.filter((c) => c.status !== 'exited');
    } else {
      list = list.filter((c) => this.bucket(c) === filter);
    }
    if (q) {
      list = list
        .map((c) => ({ c, score: this.searchScore(c, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
    } else {
      list = [...list].sort((a, b) => {
        const ai = a.priority === 'emergency' ? 1 : 0;
        const bi = b.priority === 'emergency' ? 1 : 0;
        if (bi !== ai) return bi - ai;
        return 0;
      });
    }
    return list;
  });

  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.socketSubs.push(
      this.route.queryParamMap.subscribe((params) => {
        const as = (params.get('as') || '').trim();
        const role = this.auth.getSession()?.role;
        if (role === 'admin' && as) {
          this.viewingAsDoctor.set(as);
        } else {
          this.viewingAsDoctor.set(null);
        }
        this.loadNotificationsFromStorage();
        this.loadCases();
      })
    );
    this.socketService.connect();
    const socket = (this.socketService as any).socket;
    if (socket) {
      const refresh = () => this.scheduleBackgroundReload();
      socket.on('case:created', refresh);
      socket.on('case:updated', refresh);
      this.socketSubs.push({
        unsubscribe: () => {
          socket.off('case:created', refresh);
          socket.off('case:updated', refresh);
        },
      } as Subscription);
    }
  }

  ngOnDestroy(): void {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
    this.socketSubs.forEach((s) => s.unsubscribe());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    const el = ev.target as HTMLElement;
    if (el.closest('.notif-bell') || el.closest('.notifications-panel')) return;
    this.notificationsOpen.set(false);
  }

  private scheduleBackgroundReload(): void {
    if (this.reloadDebounceTimer) clearTimeout(this.reloadDebounceTimer);
    this.reloadDebounceTimer = setTimeout(() => {
      this.reloadDebounceTimer = null;
      this.loadCases({ silent: true });
    }, 2000);
  }

  private loadCases(opts?: { silent?: boolean }): void {
    if (!opts?.silent) this.casesLoading.set(true);
    this.caseApi.getAllCases(1, 1500).subscribe({
      next: (res) => {
        const rows = (res?.data ?? []) as Record<string, unknown>[];
        if (Array.isArray(rows)) {
          const mapped = rows.map((r) => mapApiCaseToDentalCase(r));
          this.sharedCases.setCasesFromServer(mapped);
          this.processStatusNotifications(mapped, !opts?.silent);
        }
        this.casesLoading.set(false);
      },
      error: () => {
        this.casesLoading.set(false);
        if (!opts?.silent) this.flash('❌ تعذر تحميل الحالات');
      },
    });
  }

  private notifStorageKey(): string {
    const id = this.auth.getSession()?.id || 'anon';
    const as = this.viewingAsDoctor()?.trim();
    if (as && this.auth.getSession()?.role === 'admin') {
      return `doctor_portal_notifs_${id}_as_${as}`;
    }
    return `doctor_portal_notifs_${id}`;
  }

  private loadNotificationsFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.notifStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as DoctorNotif[];
      if (Array.isArray(parsed)) {
        this.notifications.set(parsed.slice(0, 40));
      }
    } catch {
      /* ignore */
    }
  }

  private persistNotifications(): void {
    try {
      localStorage.setItem(this.notifStorageKey(), JSON.stringify(this.notifications().slice(0, 40)));
    } catch {
      /* ignore */
    }
  }

  private processStatusNotifications(cases: DentalCase[], isInitial: boolean): void {
    const nextKnown = new Map<string, DoctorStage>();
    const fresh: DoctorNotif[] = [];

    for (const c of cases) {
      const b = this.bucket(c);
      nextKnown.set(c.id, b);
      if (!this.notifHydrated) continue;
      const prev = this.knownStatus.get(c.id);
      if (!prev || prev === b) continue;
      if (b !== 'finished' && b !== 'exited') continue;
      if (prev === 'finished' && b === 'exited') {
        /* allow exit after finish */
      } else if (prev === 'exited' || prev === 'finished') {
        continue;
      }
      const kind = b as 'finished' | 'exited';
      const message =
        kind === 'finished'
          ? `حالة ${c.caseNumber} للمريض ${c.patient} أصبحتتهية`
          : `حالة ${c.caseNumber} للمريض ${c.patient} خرجت من المعمل`;
      fresh.push({
        id: `${c.id}-${kind}-${Date.now()}`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        patient: c.patient,
        kind,
        message,
        at: Date.now(),
        read: false,
      });
    }

    this.knownStatus = nextKnown;
    this.notifHydrated = true;

    if (isInitial || fresh.length === 0) return;

    this.notifications.update((list) => [...fresh, ...list].slice(0, 40));
    this.persistNotifications();
    const last = fresh[0];
    if (last) this.flash(last.kind === 'finished' ? `✅ ${last.message}` : `📦 ${last.message}`);
  }

  toggleNotifications(ev: Event): void {
    ev.stopPropagation();
    const opening = !this.notificationsOpen();
    this.notificationsOpen.set(opening);
    if (opening) this.markAllNotificationsRead();
  }

  markAllNotificationsRead(): void {
    const hasUnread = this.notifications().some((n) => !n.read);
    if (!hasUnread) return;
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
    this.persistNotifications();
  }

  openNotification(n: DoctorNotif): void {
    this.notificationsOpen.set(false);
    const c = this.allCases().find((x) => x.id === n.caseId);
    if (c) {
      this.openDetails(c);
      return;
    }
    this.activeFilter.set(n.kind);
    this.flash('الحالة غير موجودة في القائمة الحالية');
  }

  setFilter(f: DoctorFilter): void {
    this.activeFilter.set(f);
  }

  private normalizeDoctorKey(name: string): string {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');
  }

  private normalizeSearch(v: string): string {
    return String(v || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .trim();
  }

  private searchScore(c: DentalCase, q: string): number {
    const patient = this.normalizeSearch(c.patient);
    const work = this.normalizeSearch(this.formatWorkTypeForDisplay(c.workType));
    const color = this.normalizeSearch(c.color);
    const branch = this.normalizeSearch(c.branch || c.clinic || '');
    const detail = this.normalizeSearch(c.workDetail || '');
    const num = this.normalizeSearch(c.caseNumber);
    const tokens = q.split(/\s+/).filter(Boolean);
    const hay = `${patient} ${work} ${color} ${branch} ${detail} ${num}`;
    if (!tokens.every((t) => hay.includes(t))) return 0;
    if (patient.includes(q) || patient.startsWith(q)) return 120;
    if (work.includes(q)) return 100;
    if (color.includes(q)) return 90;
    if (branch.includes(q)) return 85;
    if (num.includes(q)) return 80;
    return 50;
  }

  openDetails(c: DentalCase): void {
    this.detailCase.set(c);
    this.detailOpen.set(true);
  }

  closeDetails(): void {
    this.detailOpen.set(false);
    this.detailCase.set(null);
  }

  openDialog(): void {
    this.dialogMode.set('create');
    this.editingId = null;
    this.formDraft = emptyDraft();
    this.selectedWorkTypes.clear();
    this.workTypeQuantities = {};
    this.workTypeError = '';
    this.patientNameError = '';
    this.nightGuardType = '';
    this.dialogOpen.set(true);
  }

  openEditFromDetail(): void {
    const c = this.detailCase();
    if (!c || !this.canEdit(c)) {
      this.flash('التعديل متاح فقط قبل دخول الديزاين');
      return;
    }
    this.closeDetails();
    this.openEdit(c);
  }

  openEdit(c: DentalCase): void {
    if (!this.canEdit(c)) {
      this.flash('التعديل متاح فقط قبل دخول الديزاين');
      return;
    }
    this.dialogMode.set('edit');
    this.editingId = c.id;
    const caseType = this.getCaseTypeFromWorkType(c.workType);
    this.formDraft = {
      caseNumber: c.caseNumber,
      patient: c.patient,
      workType: c.workType,
      workDetail: c.workDetail || '',
      color: c.color || '',
      branch: c.branch || c.clinic || '',
      quantity: c.quantity || 1,
      date: todayYmd(),
      caseType,
      urgent: c.priority === 'emergency',
    };
    this.selectedWorkTypes = new Set();
    this.workTypeQuantities = {};
    this.workTypeError = '';
    this.patientNameError = '';
    this.nightGuardType = '';
    this.restoreWorkTypes(c.workType, caseType, c.quantity);
    this.dialogOpen.set(true);
  }

  private getCaseTypeFromWorkType(wt: string): 'New' | 'Modification' | 'Redo' | 'Empty' {
    const s = String(wt || '');
    if (s === 'Empty' || s === 'غير معروف') return 'Empty';
    if (s === 'Modification' || s.startsWith('Modification - ') || s.startsWith('تعديل')) return 'Modification';
    if (s === 'Redo' || s === 'Remake' || s.startsWith('Redo - ') || s.startsWith('اعادة')) return 'Redo';
    return 'New';
  }

  private restoreWorkTypes(
    workType: string,
    caseType: 'New' | 'Modification' | 'Redo' | 'Empty',
    quantity: number
  ): void {
    if (caseType === 'Empty' || !workType) return;
    let wtToParse = workType;
    if (wtToParse.startsWith('Modification - ')) wtToParse = wtToParse.replace('Modification - ', '');
    else if (wtToParse === 'Modification') wtToParse = '';
    else if (wtToParse.startsWith('Redo - ')) wtToParse = wtToParse.replace('Redo - ', '');
    else if (wtToParse === 'Redo' || wtToParse === 'Remake') wtToParse = '';
    else if (wtToParse.startsWith('تعديل - ')) wtToParse = wtToParse.replace('تعديل - ', '');
    else if (wtToParse.startsWith('اعادة - ')) wtToParse = wtToParse.replace('اعادة - ', '');

    if (!wtToParse) return;
    const parts = wtToParse.split('+').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const match = p.match(/^(.*?)(?:\s*\((\d+)\))?$/);
      if (!match) continue;
      let wtName = match[1].trim();
      const qty = match[2] ? parseInt(match[2], 10) : 1;
      if (wtName.startsWith('Night Guard') || wtName.startsWith('Night Gard')) {
        this.selectedWorkTypes.add('Night Guard');
        this.workTypeQuantities['Night Guard'] = qty;
        this.nightGuardType = wtName.includes('Hard') ? 'Hard' : 'Soft';
      } else if (this.workTypeOptions.includes(wtName)) {
        this.selectedWorkTypes.add(wtName);
        this.workTypeQuantities[wtName] = qty;
      }
    }
    if (this.selectedWorkTypes.size === 1 && !workType.includes('(')) {
      const only = [...this.selectedWorkTypes][0];
      this.workTypeQuantities[only] = Number(quantity) || 1;
    }
    if (this.selectedWorkTypes.size > 0) this.updateWorkTypeString();
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    this.editingId = null;
  }

  onCaseTypeChange(): void {
    if (this.formDraft.caseType === 'Empty') {
      this.selectedWorkTypes.clear();
      this.workTypeQuantities = {};
      this.nightGuardType = '';
      this.workTypeError = '';
      this.formDraft.workType = 'Empty';
      this.formDraft.quantity = 0;
      return;
    }
    this.updateWorkTypeString();
  }

  toggleWorkType(type: string): void {
    if (this.selectedWorkTypes.has(type)) {
      this.selectedWorkTypes.delete(type);
      delete this.workTypeQuantities[type];
      if (type === 'Night Guard') this.nightGuardType = '';
    } else {
      this.selectedWorkTypes.add(type);
      this.workTypeQuantities[type] = this.workTypeQuantities[type] || 1;
      if (type === 'Night Guard') this.nightGuardType = 'Soft';
    }
    this.workTypeError = '';
    this.updateWorkTypeString();
  }

  isWorkTypeSelected(type: string): boolean {
    return this.selectedWorkTypes.has(type);
  }

  get hasWorkTypesWithQuantity(): boolean {
    for (const wt of this.selectedWorkTypes) {
      if (wt !== 'Remake' && wt !== 'Empty') return true;
    }
    return false;
  }

  setNightGuardType(type: 'Soft' | 'Hard'): void {
    this.nightGuardType = type;
    this.updateWorkTypeString();
  }

  onWorkTypeQtyChange(): void {
    this.updateWorkTypeString();
  }

  updateWorkTypeString(): void {
    if (this.formDraft.caseType === 'Empty') {
      this.formDraft.workType = 'Empty';
      this.formDraft.quantity = 0;
      return;
    }
    let total = 0;
    const parts: string[] = [];
    for (const wt of this.selectedWorkTypes) {
      const q = Number(this.workTypeQuantities[wt]) || 1;
      total += q;
      let displayName = wt;
      if (wt === 'Night Guard') {
        displayName = this.nightGuardType ? `Night Guard ${this.nightGuardType}` : 'Night Guard';
      }
      if (this.selectedWorkTypes.size > 1 || q > 1) {
        parts.push(`${displayName} (${q})`);
      } else {
        parts.push(displayName);
      }
    }
    let finalString = parts.join(' + ');
    if (this.formDraft.caseType === 'Modification' && finalString) {
      finalString = 'Modification - ' + finalString;
    } else if (this.formDraft.caseType === 'Redo' && finalString) {
      finalString = 'Redo - ' + finalString;
    } else if (
      (this.formDraft.caseType === 'Modification' || this.formDraft.caseType === 'Redo') &&
      !finalString
    ) {
      finalString = this.formDraft.caseType;
    }
    this.formDraft.workType = finalString;
    this.formDraft.quantity = total || 1;
  }

  private isBinaryPatientName(name: string): boolean {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2;
  }

  save(): void {
    const d = this.formDraft;
    const doctor = this.doctorName();
    if (!doctor || doctor === '—') {
      this.flash('تعذر قراءة اسم الدكتور من الحساب');
      return;
    }
    if (!d.patient?.trim()) {
      this.flash('يرجى إدخال اسم المريض');
      return;
    }
    if (!this.isBinaryPatientName(d.patient)) {
      this.patientNameError = 'يرجى كتابة الاسم ثنائي';
      this.flash('يرجى كتابة الاسم ثنائي');
      return;
    }
    this.patientNameError = '';
    if (!d.branch?.trim()) {
      this.flash('يرجى إدخال الفرع');
      return;
    }
    if (d.caseType !== 'Empty' && this.selectedWorkTypes.size === 0) {
      this.workTypeError = 'يرجى اختيار نوع عمل واحد على الأقل';
      this.flash('يرجى اختيار نوع العمل');
      return;
    }
    if (this.isColorRequired && !d.color?.trim()) {
      this.flash('يرجى إدخال اللون');
      return;
    }

    this.updateWorkTypeString();
    const isEdit = this.dialogMode() === 'edit' && !!this.editingId;
    const editId = this.editingId;
    this.closeDialog();
    this.saveInProgress.set(true);

    const draft = {
      doctor,
      patient: d.patient.trim(),
      branch: d.branch.trim(),
      caseType: d.caseType,
      workType: d.workType.trim(),
      workDetail: (d.workDetail || '').trim(),
      color: (d.color || '').trim(),
      quantity: d.caseType === 'Empty' ? 0 : d.quantity || 1,
      date: todayYmd(),
      urgent: !!d.urgent,
    };

    const casePayload = buildCasePayloadFromPrintForm(draft, {
      requesterType: 'doctor',
      priority: d.urgent ? 'urgent' : isEdit ? 'normal' : undefined,
    });

    if (isEdit && editId) {
      this.caseApi.updateCase(editId, casePayload).subscribe({
        next: () => {
          this.saveInProgress.set(false);
          this.flash('✅ تم تحديث الريكويست');
          this.loadCases();
        },
        error: (err) => {
          this.saveInProgress.set(false);
          this.flash(err?.error?.message || '❌ فشل التحديث');
          this.loadCases({ silent: true });
        },
      });
      return;
    }

    this.caseApi
      .createCase(casePayload)
      .pipe(
        switchMap((res: { case?: { caseNumber?: string } }) => {
          const caseNumber = String(res?.case?.caseNumber ?? '');
          return this.http.post(`${this.apiBase}/print/job`, {
            printData: buildPrintData(draft, caseNumber),
          });
        })
      )
      .subscribe({
        next: () => {
          this.saveInProgress.set(false);
          this.flash(
            d.urgent
              ? '✅ تم حفظ الحالة المستعجلة وإرسالها للطباعة'
              : '✅ تم حفظ الحالة وإرسال الريكويست للطباعة'
          );
          this.loadCases();
        },
        error: () => {
          this.saveInProgress.set(false);
          this.flash('❌ فشل الحفظ أو الطباعة، تحقق من الاتصال');
          this.loadCases({ silent: true });
        },
      });
  }

  logout(): void {
    if (this.isAdminView()) {
      this.backToAdminDoctors();
      return;
    }
    this.auth.performLogout(this.router);
  }

  backToAdminDoctors(): void {
    this.router.navigate(['/admin/dashboard'], {
      queryParams: { nav: 'doctors' },
    });
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 3500);
  }

  formatWorkTypeForDisplay(wt: string): string {
    return formatWorkTypeForPrint(wt);
  }

  getCasePhase(c: DentalCase): { label: string; color: string } {
    const b = this.bucket(c);
    const map: Record<DoctorStage, { label: string; color: string }> = {
      pending: { label: 'الجديدة', color: 'pending' },
      design: { label: 'ديزاين', color: 'design' },
      finishing: { label: 'فينيش', color: 'khart' },
      finished: { label: 'منتهية', color: 'finished' },
      exited: { label: 'خارجة', color: 'exited' },
    };
    return map[b];
  }

  formatDateTime(value: string): { date: string; time: string } {
    if (!value) return { date: '—', time: '' };
    try {
      const raw = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        const local = new Date(y, m - 1, d);
        return {
          date: local.toLocaleDateString('ar-EG-u-nu-latn', {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
          }),
          time: '',
        };
      }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        const parts = raw.split(/\s+/);
        return { date: parts[0] || raw, time: parts.slice(1).join(' ') };
      }
      return {
        date: d.toLocaleDateString('ar-EG-u-nu-latn', {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
        }),
        time: d.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
      };
    } catch {
      return { date: value, time: '' };
    }
  }

  caseReceivedStamp(c: DentalCase): string {
    return c.createdAt || c.receivedDateRaw || c.receivedDate || '';
  }

  formatNotifTime(at: number): string {
    try {
      return new Date(at).toLocaleString('ar-EG-u-nu-latn', {
        day: 'numeric',
        month: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  }
}
