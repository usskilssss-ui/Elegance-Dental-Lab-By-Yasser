import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { SharedCasesService, DentalCase } from '../../core/services/shared-cases.service';
import { buildCreateCasePayload, mapApiCaseToDentalCase } from '../../core/mappers/dental-case-api.mapper';
import { SocketService } from '../../core/services/socket.service';
import { ThemeService } from '../../core/services/theme.service';
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
  };
}

type DoctorFilter =
  | 'all'
  | 'pending'
  | 'design'
  | 'finishing'
  | 'finished'
  | 'exited';

@Component({
  selector: 'app-doctor',
  standalone: true,
  imports: [CommonModule, FormsModule, PatientLabelPipe],
  templateUrl: './doctor.html',
  styleUrls: ['../secretary/secretary.css'],
})
export class DoctorComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly caseApi = inject(CaseApiService);
  private readonly sharedCases = inject(SharedCasesService);
  private readonly socketService = inject(SocketService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  public readonly themeService = inject(ThemeService);

  private readonly apiBase = environment.apiUrl;
  private readonly socketSubs: Subscription[] = [];

  readonly doctorName = computed(() => this.auth.getSession()?.name?.trim() || '—');
  readonly casesLoading = signal(true);
  readonly toast = signal<string | null>(null);
  readonly dialogOpen = signal(false);
  readonly saveInProgress = signal(false);
  readonly activeFilter = signal<DoctorFilter>('all');
  readonly searchQuery = signal('');

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

  get searchQueryValue(): string {
    return this.searchQuery();
  }
  set searchQueryValue(v: string) {
    this.searchQuery.set(v);
  }

  private bucket(c: DentalCase): DoctorFilter {
    if (c.status === 'exited') return 'exited';
    const stage = String(c.currentStage || '').toLowerCase();
    if (stage === 'finishing') return 'finishing';
    if (c.status === 'finished' || stage === 'completed') return 'finished';
    if (c.status === 'in-progress' || c.status === 'under-khart' || c.status === 'needs-revision') {
      return 'design';
    }
    return 'pending';
  }

  readonly allCases = computed(() => this.sharedCases.cases());

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
    return {
      all: active.length,
      pending: all.filter((c) => this.bucket(c) === 'pending').length,
      design: all.filter((c) => this.bucket(c) === 'design').length,
      finishing: all.filter((c) => this.bucket(c) === 'finishing').length,
      finished: all.filter((c) => this.bucket(c) === 'finished').length,
      exited: all.filter((c) => this.bucket(c) === 'exited').length,
    };
  });

  readonly cases = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();
    let list = this.allCases();
    if (filter === 'all') {
      list = list.filter((c) => c.status !== 'exited');
    } else {
      list = list.filter((c) => this.bucket(c) === filter);
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.patient?.toLowerCase().includes(q) ||
          c.caseNumber?.toLowerCase().includes(q) ||
          c.workType?.toLowerCase().includes(q)
      );
    }
    return list;
  });

  ngOnInit(): void {
    this.loadCases();
    this.socketService.connect();
    const socket = (this.socketService as any).socket;
    if (socket) {
      const refresh = () => this.loadCases({ silent: true });
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
    this.socketSubs.forEach((s) => s.unsubscribe());
  }

  private loadCases(opts?: { silent?: boolean }): void {
    if (!opts?.silent) this.casesLoading.set(true);
    this.caseApi.getAllCases(1, 3000).subscribe({
      next: (res) => {
        const rows = (res?.data ?? []) as Record<string, unknown>[];
        if (Array.isArray(rows)) {
          this.sharedCases.setCasesFromServer(rows.map((r) => mapApiCaseToDentalCase(r)));
        }
        this.casesLoading.set(false);
      },
      error: () => {
        this.casesLoading.set(false);
        if (!opts?.silent) this.flash('❌ تعذر تحميل الحالات');
      },
    });
  }

  setFilter(f: DoctorFilter): void {
    this.activeFilter.set(f);
  }

  openDialog(): void {
    this.formDraft = emptyDraft();
    this.selectedWorkTypes.clear();
    this.workTypeQuantities = {};
    this.workTypeError = '';
    this.patientNameError = '';
    this.nightGuardType = '';
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
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
    if (d.caseType !== 'Empty' && !d.color?.trim()) {
      this.flash('يرجى إدخال اللون');
      return;
    }

    this.updateWorkTypeString();
    this.closeDialog();
    this.saveInProgress.set(true);

    const now = new Date();
    const printDate =
      now.toLocaleDateString('en-GB') +
      '  ' +
      now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const casePayload = buildCreateCasePayload({
      requesterType: 'doctor',
      doctor,
      patient: d.patient.trim(),
      workType: d.workType.trim(),
      workDetail: (d.workDetail || '').trim(),
      color: (d.color || '').trim(),
      size: '',
      quantity: d.caseType === 'Empty' ? 0 : d.quantity || 1,
      date: todayYmd(),
    });

    const printData = {
      doctor,
      patient: d.patient.trim(),
      branch: d.branch.trim(),
      caseType: d.caseType,
      workType: d.workType.trim(),
      workDetail: (d.workDetail || '').trim(),
      color: (d.color || '').trim(),
      quantity: d.caseType === 'Empty' ? 0 : d.quantity || 1,
      caseNumber: '',
      printDate,
    };

    this.caseApi
      .createCase(casePayload)
      .pipe(
        switchMap(() =>
          this.http.post(`${this.apiBase}/print/job`, { printData })
        )
      )
      .subscribe({
        next: () => {
          this.saveInProgress.set(false);
          this.flash('✅ تم حفظ الحالة وإرسال الريكويست للطباعة');
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
    this.auth.performLogout(this.router);
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 3500);
  }

  formatWorkTypeForDisplay(wt: string): string {
    if (!wt) return '';
    if (wt === 'Empty') return 'غير معروف';
    if (wt === 'Modification') return 'تعديل';
    if (wt === 'Redo' || wt === 'Remake') return 'اعادة';
    let display = wt;
    if (display.startsWith('Modification - ')) display = display.replace('Modification - ', 'تعديل - ');
    else if (display.startsWith('Redo - ')) display = display.replace('Redo - ', 'اعادة - ');
    return display;
  }

  getCasePhase(c: DentalCase): { label: string; color: string } {
    const b = this.bucket(c);
    const map: Record<DoctorFilter, { label: string; color: string }> = {
      all: { label: '', color: 'pending' },
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
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        // already formatted display string
        const parts = String(value).split(/\s+/);
        return { date: parts[0] || value, time: parts.slice(1).join(' ') };
      }
      return {
        date: d.toLocaleDateString('ar-EG-u-nu-latn', {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
        }),
        time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
    } catch {
      return { date: value, time: '' };
    }
  }
}
