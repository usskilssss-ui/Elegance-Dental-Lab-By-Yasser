import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { SharedCasesService } from '../../core/services/shared-cases.service';
import { UserApiService } from '../../core/services/user-api.service';
import { mapApiCaseToDentalCase } from '../../core/mappers/dental-case-api.mapper';
import {
  buildCasePayloadFromPrintForm,
  buildPrintData,
  formatPrintDate,
  formatWorkTypeForPrint,
} from '../../core/utils/print-job.util';
import { Subscription, catchError, switchMap } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { SocketService } from '../../core/services/socket.service';
import { ThemeService } from '../../core/services/theme.service';
import { environment } from '../../../environments/environment';

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
    doctor: '',
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

export interface PrintJobCard {
  _id: string;
  printData: {
    doctor: string;
    patient: string;
    branch?: string;
    caseType: string;
    workType: string;
    workDetail: string;
    color: string;
    quantity: number;
    caseNumber: string;
    printDate: string;
    intakeType?: string;
  };
  status: 'pending' | 'printing' | 'done' | 'failed';
  paperConfirmed?: 'pending' | 'yes' | 'no';
  errorMessage?: string;
  createdAt: string;
}

@Component({
  selector: 'app-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './entry.html',
  styleUrl: './entry.css',
})
export class EntryComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly caseApi = inject(CaseApiService);
  private readonly sharedCases = inject(SharedCasesService);
  private readonly userApi = inject(UserApiService);
  private readonly socketService = inject(SocketService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  public readonly themeService = inject(ThemeService);

  private readonly apiBase = environment.apiUrl;
  private readonly socketSubs: Subscription[] = [];
  private jobsPollTimer: ReturnType<typeof setInterval> | null = null;
  private onVisibilityChange: (() => void) | null = null;

  readonly dialogOpen = signal(false);
  readonly saveInProgress = signal(false);
  readonly toast = signal<string | null>(null);
  readonly notificationsOpen = signal(false);
  readonly jobsLoading = signal(true);
  readonly showReceptionHub = signal(false);

  // Today's print jobs list
  readonly printJobs = signal<PrintJobCard[]>([]);

  // Search filter
  readonly searchTerm = signal<string>('');

  readonly filteredJobs = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const jobs = this.printJobs();
    if (!term) return jobs;
    return jobs.filter(j =>
      (j.printData.doctor || '').toLowerCase().includes(term) ||
      (j.printData.patient || '').toLowerCase().includes(term) ||
      (j.printData.branch || '').toLowerCase().includes(term)
    );
  });

  readonly doneJobsCount = computed(() =>
    this.printJobs().filter(j => j.status === 'done' && j.paperConfirmed === 'yes').length
  );
  readonly awaitingConfirmCount = computed(() =>
    this.printJobs().filter(j => j.status === 'done' && (j.paperConfirmed || 'pending') !== 'yes').length
  );
  readonly pendingJobsCount = computed(() =>
    this.printJobs().filter(j => j.status === 'pending' || j.status === 'printing').length
  );
  readonly failedJobsCount = computed(() => this.printJobs().filter(j => j.status === 'failed').length);

  formDraft = emptyDraft();

  // Work type state
  readonly workTypeOptions = [
    'Zircon', 'German Zircon', 'Emax', 'Pmma Cad',
    'Peek', 'Titanium', 'Try in', 'Mokup',
    'Night Guard', 'Wax', 'Ring'
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
  patientWarning = '';
  intakeType: 'impression' | 'scan' | '' = '';
  selectedPlyFile: File | null = null;

  // Doctor autocomplete — اقتراحات من أكونتات الدكاترة فقط (الكتابة الحرة مسموحة)
  readonly accountDoctors = signal<string[]>([]);
  readonly showDoctorSuggestions = signal(false);
  readonly activeSuggestionIndex = signal(-1);
  private doctorSearchQuery = '';

  get filteredDoctors(): string[] {
    const doctors = [...this.accountDoctors()].sort((a, b) => a.localeCompare(b, 'ar'));
    const q = this.normalizeArabic(this.doctorSearchQuery);
    if (!q) return doctors.slice(0, 10);
    return doctors.filter((d) => this.normalizeArabic(d).includes(q));
  }

  normalizeArabic(text: string): string {
    if (!text) return '';
    return text
      .trim()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ');
  }

  private loadAccountDoctors(): void {
    this.userApi.getUsersByRole('doctor').subscribe({
      next: (res) => {
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const names = rows
          .map((u: any) => String(u?.fullName || '').trim())
          .filter((n: string) => !!n);
        this.accountDoctors.set(Array.from(new Set(names)));
      },
      error: () => this.accountDoctors.set([]),
    });
  }

  setIntakeType(type: 'impression' | 'scan'): void {
    if (this.intakeType === type) {
      this.intakeType = '';
      this.clearPlySelection();
      return;
    }
    this.intakeType = type;
    if (type === 'impression') this.clearPlySelection();
  }

  onPatientInputChange(): void {
    const name = (this.formDraft.patient || '').trim();
    if (!name) {
      this.patientWarning = '';
      return;
    }
    const parts = name.split(/\s+/).filter((p) => p);
    this.patientWarning =
      parts.length < 2 ? 'اسم المريض إجباري ثنائي (مثال: محمد أحمد).' : '';
  }

  onPlyFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.selectedPlyFile = null;
      return;
    }
    if (!file.name.toLowerCase().endsWith('.ply')) {
      this.flash('يُسمح فقط بملفات بصيغة .ply');
      input.value = '';
      this.selectedPlyFile = null;
      return;
    }
    this.selectedPlyFile = file;
  }

  clearPlySelection(): void {
    this.selectedPlyFile = null;
    const el = document.getElementById('entryPlyInput') as HTMLInputElement | null;
    if (el) el.value = '';
  }

  onDoctorInputChange(): void {
    this.doctorSearchQuery = this.formDraft.doctor || '';
    this.activeSuggestionIndex.set(-1);
    this.showDoctorSuggestions.set(true);
  }

  onDoctorInputFocus(): void {
    this.doctorSearchQuery = this.formDraft.doctor || '';
    this.showDoctorSuggestions.set(true);
    this.activeSuggestionIndex.set(-1);
  }

  onDoctorInputBlur(): void {
    setTimeout(() => this.showDoctorSuggestions.set(false), 200);
  }

  selectDoctor(doc: string): void {
    this.formDraft.doctor = doc;
    this.doctorSearchQuery = doc;
    this.showDoctorSuggestions.set(false);
    this.activeSuggestionIndex.set(-1);
  }

  onDoctorInputKeydown(event: KeyboardEvent): void {
    const list = this.filteredDoctors;
    if (!this.showDoctorSuggestions() || list.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeSuggestionIndex.set((this.activeSuggestionIndex() + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeSuggestionIndex.set((this.activeSuggestionIndex() - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      const idx = this.activeSuggestionIndex();
      if (idx >= 0 && idx < list.length) {
        event.preventDefault();
        this.selectDoctor(list[idx]);
      }
    } else if (event.key === 'Escape') {
      this.showDoctorSuggestions.set(false);
    }
  }

  // Work type logic
  onCaseTypeChange(): void {
    if (this.formDraft.caseType === 'Empty') {
      this.selectedWorkTypes.clear();
      this.workTypeQuantities = {};
      this.nightGuardType = '';
      this.formDraft.workType = 'Empty';
      this.formDraft.quantity = 0;
    } else {
      this.updateWorkTypeString();
    }
  }

  toggleWorkType(type: string): void {
    this.workTypeError = '';
    if (this.selectedWorkTypes.has(type)) {
      this.selectedWorkTypes.delete(type);
      delete this.workTypeQuantities[type];
      if (type === 'Night Guard') this.nightGuardType = '';
    } else {
      if (type === 'Empty') {
        this.selectedWorkTypes.clear();
        this.workTypeQuantities = {};
        this.selectedWorkTypes.add('Empty');
        this.workTypeQuantities['Empty'] = 1;
        this.nightGuardType = '';
      } else {
        this.selectedWorkTypes.delete('Empty');
        delete this.workTypeQuantities['Empty'];
        this.selectedWorkTypes.add(type);
        this.workTypeQuantities[type] = 1;
        if (type === 'Night Guard') this.nightGuardType = 'Soft';
      }
    }
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
    } else if ((this.formDraft.caseType === 'Modification' || this.formDraft.caseType === 'Redo') && !finalString) {
      finalString = this.formDraft.caseType;
    }
    this.formDraft.workType = finalString;
    this.formDraft.quantity = total || 1;
  }

  private sortJobs(jobs: PrintJobCard[]): PrintJobCard[] {
    const rank = (j: PrintJobCard) => {
      if (j.status === 'failed') return 0;
      if (j.status === 'done' && (j.paperConfirmed || 'pending') !== 'yes') return 1;
      if (j.status === 'printing' || j.status === 'pending') return 2;
      return 3;
    };
    return [...jobs].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  private loadTodayJobs(opts?: { silent?: boolean }): void {
    if (!opts?.silent) this.jobsLoading.set(true);
    this.http.get<{ success: boolean; jobs: PrintJobCard[] }>(`${this.apiBase}/print/jobs/today`).subscribe({
      next: res => {
        if (res.success) this.printJobs.set(this.sortJobs(res.jobs));
        this.jobsLoading.set(false);
      },
      error: () => this.jobsLoading.set(false),
    });
  }

  ngOnInit(): void {
    const role = this.auth.getSession()?.role;
    this.showReceptionHub.set(role === 'secretary' || role === 'admin');
    this.loadAccountDoctors();

    // Load cases (for list context / shared state)
    this.caseApi.getAllCases(1, 1500).subscribe({
      next: res => {
        const rows = (res?.data ?? []) as Record<string, unknown>[];
        if (Array.isArray(rows)) {
          this.sharedCases.setCasesFromServer(rows.map(r => mapApiCaseToDentalCase(r)));
        }
      },
      error: () => {}
    });

    // Load today's print jobs
    this.loadTodayJobs();

    // Poll so jobs still appear if the agent PC slept or the socket missed events
    this.jobsPollTimer = setInterval(() => this.loadTodayJobs({ silent: true }), 30000);

    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible') this.loadTodayJobs({ silent: true });
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // Real-time: listen for new jobs
    this.socketService.connect();
    const socket = (this.socketService as any).socket;
    if (socket) {
      const onNew = (job: PrintJobCard & { jobId?: string }) => {
        const normalized: PrintJobCard = {
          ...job,
          _id: job._id || job.jobId || '',
        };
        if (!normalized._id) return;
        this.printJobs.update(jobs => {
          if (jobs.some(j => j._id === normalized._id)) return jobs;
          return this.sortJobs([...jobs, normalized]);
        });
      };
      const onUpdate = (data: {
        jobId: string;
        status: string;
        paperConfirmed?: PrintJobCard['paperConfirmed'];
        errorMessage?: string;
      }) => {
        this.printJobs.update(jobs =>
          this.sortJobs(
            jobs.map(j =>
              j._id === data.jobId
                ? {
                    ...j,
                    status: data.status as PrintJobCard['status'],
                    paperConfirmed: data.paperConfirmed ?? j.paperConfirmed,
                    errorMessage: data.errorMessage ?? j.errorMessage,
                  }
                : j
            )
          )
        );
      };
      const onDelete = (data: { jobId: string }) => {
        this.printJobs.update(jobs => jobs.filter(j => j._id !== data.jobId));
      };
      const onClearAll = () => {
        this.printJobs.set([]);
      };
      socket.on('print:job-created', onNew);
      socket.on('print:job-status-updated', onUpdate);
      socket.on('print:job-deleted', onDelete);
      socket.on('print:all-jobs-cleared', onClearAll);
      this.socketSubs.push({ unsubscribe: () => {
        socket.off('print:job-created', onNew);
        socket.off('print:job-status-updated', onUpdate);
        socket.off('print:job-deleted', onDelete);
        socket.off('print:all-jobs-cleared', onClearAll);
      }} as Subscription);
    }
  }

  ngOnDestroy(): void {
    this.socketSubs.forEach(s => s.unsubscribe());
    if (this.jobsPollTimer) {
      clearInterval(this.jobsPollTimer);
      this.jobsPollTimer = null;
    }
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
  }

  openDialog(): void {
    this.formDraft = emptyDraft();
    this.selectedWorkTypes.clear();
    this.workTypeQuantities = {};
    this.workTypeError = '';
    this.nightGuardType = '';
    this.patientWarning = '';
    this.intakeType = '';
    this.clearPlySelection();
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    this.clearPlySelection();
  }

  save(): void {
    const d = this.formDraft;

    if (!d.doctor.trim()) { this.flash('يرجى تعبئة اسم الطبيب'); return; }
    if (!d.patient?.trim()) { this.flash('يرجى إدخال اسم المريض'); return; }
    const patientParts = d.patient.trim().split(/\s+/).filter((p) => p);
    if (patientParts.length < 2) {
      this.patientWarning = 'اسم المريض إجباري ثنائي (مثال: محمد أحمد).';
      this.flash('اسم المريض يجب أن يكون ثنائيًا على الأقل');
      return;
    }
    if (!d.branch?.trim()) { this.flash('يرجى إدخال الفرع'); return; }
    if (!this.intakeType) {
      this.flash('اختَر امبرشن أو سكان');
      return;
    }
    if (d.caseType !== 'Empty' && this.selectedWorkTypes.size === 0) {
      this.workTypeError = 'يرجى اختيار نوع عمل واحد على الأقل';
      this.flash('يرجى اختيار نوع العمل');
      return;
    }

    this.updateWorkTypeString();
    const draft = {
      doctor: d.doctor.trim(),
      patient: d.patient.trim(),
      branch: d.branch.trim(),
      caseType: d.caseType,
      workType: d.workType.trim(),
      workDetail: (d.workDetail || '').trim(),
      color: (d.color || '').trim(),
      quantity: d.caseType === 'Empty' ? 0 : (d.quantity || 1),
      date: d.date,
      intakeType: (this.intakeType === 'scan' || this.intakeType === 'impression'
        ? this.intakeType
        : undefined) as 'impression' | 'scan' | undefined,
    };
    const ply = this.intakeType === 'scan' ? this.selectedPlyFile : null;

    this.closeDialog();
    this.saveInProgress.set(true);

    this.caseApi
      .createCase(buildCasePayloadFromPrintForm(draft, { entrySource: 'print' }))
      .pipe(
        switchMap((res: { case?: { caseNumber?: string; _id?: string; id?: string } }) => {
          const caseNumber = String(res?.case?.caseNumber ?? '');
          const caseId = String(res?.case?._id ?? res?.case?.id ?? '');
          const print$ = this.http.post(`${this.apiBase}/print/job`, {
            printData: buildPrintData(draft, caseNumber),
          });
          if (ply && caseId) {
            return this.caseApi.uploadCasePly(caseId, ply).pipe(
              switchMap(() => print$),
              catchError(() => print$)
            );
          }
          return print$;
        })
      )
      .subscribe({
        next: () => {
          this.saveInProgress.set(false);
          this.flash('✅ تم حفظ الحالة وإرسالها للطباعة');
          this.loadTodayJobs();
        },
        error: () => {
          this.saveInProgress.set(false);
          this.flash('❌ فشل إرسال الريكويست، تحقق من الاتصال');
        },
      });
  }

  logout(): void {
    this.auth.performLogout(this.router);
  }

  toggleNotifications(e: Event): void {
    e.stopPropagation();
    this.notificationsOpen.update(v => !v);
  }

  private flash(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 3500);
  }

  formatWorkTypeForDisplay(wt: string): string {
    return formatWorkTypeForPrint(wt);
  }

  formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
  }

  needsPaperConfirm(job: PrintJobCard): boolean {
    return job.status === 'done' && (job.paperConfirmed || 'pending') !== 'yes';
  }

  getStatusLabel(jobOrStatus: PrintJobCard | string): string {
    if (typeof jobOrStatus === 'string') {
      switch (jobOrStatus) {
        case 'pending': return 'انتظار';
        case 'printing': return 'جاري الطباعة';
        case 'done': return 'تمت الطباعة';
        case 'failed': return 'فشل';
        default: return jobOrStatus;
      }
    }
    const job = jobOrStatus;
    if (job.status === 'done' && job.paperConfirmed === 'yes') return 'تم التأكيد';
    if (job.status === 'done') return 'بانتظار تأكيد الورقة';
    if (job.status === 'failed' && job.paperConfirmed === 'no') return 'لم تُطبع';
    switch (job.status) {
      case 'pending': return 'انتظار';
      case 'printing': return 'جاري الطباعة';
      case 'failed': return 'فشل';
      default: return job.status;
    }
  }

  getStatusColor(jobOrStatus: PrintJobCard | string): string {
    if (typeof jobOrStatus === 'string') {
      switch (jobOrStatus) {
        case 'pending': return 'status-pending';
        case 'printing': return 'status-printing';
        case 'done': return 'status-done';
        case 'failed': return 'status-failed';
        default: return '';
      }
    }
    const job = jobOrStatus;
    if (job.status === 'done' && job.paperConfirmed === 'yes') return 'status-done';
    if (job.status === 'done') return 'status-awaiting';
    if (job.status === 'failed') return 'status-failed';
    if (job.status === 'printing') return 'status-printing';
    return 'status-pending';
  }

  confirmPaper(job: PrintJobCard, confirmed: boolean): void {
    const msg = confirmed
      ? `تأكيد إن ورقة ${job.printData.patient} طلعت؟`
      : `تأكيد إن ورقة ${job.printData.patient} ما اتطبعتش؟`;
    if (!confirm(msg)) return;

    this.http
      .patch<{ success: boolean; job?: PrintJobCard; message?: string }>(
        `${this.apiBase}/print/job/${job._id}/confirm`,
        { confirmed }
      )
      .subscribe({
        next: (res) => {
          if (res.job) {
            this.printJobs.update((jobs) =>
              this.sortJobs(jobs.map((j) => (j._id === job._id ? { ...j, ...res.job } : j)))
            );
          } else {
            this.loadTodayJobs({ silent: true });
          }
          this.flash(
            confirmed ? '✅ تم تأكيد خروج الورقة' : '❌ تم تسجيل أن الورقة لم تُطبع — يمكن إعادة الطباعة'
          );
        },
        error: () => this.flash('❌ تعذر حفظ التأكيد'),
      });
  }

  /** Reprint via Print Agent only (same path/format as doctor request link). Never browser-print. */
  reprintJob(job: PrintJobCard): void {
    this.http
      .post(`${this.apiBase}/print/job`, {
        printData: { ...job.printData, printDate: formatPrintDate() },
      })
      .subscribe({
        next: () => {
          this.flash('🖨️ تم إرسال إعادة الطباعة');
          this.loadTodayJobs();
        },
        error: () => this.flash('❌ فشل إعادة الطباعة، تحقق من الاتصال'),
      });
  }

  deleteJob(jobId: string): void {
    if (!confirm('هل أنت تأكد من حذف هذا الريكويست؟')) return;
    this.http.delete<{ success: boolean }>(`${this.apiBase}/print/job/${jobId}`).subscribe({
      next: () => {
        this.printJobs.update(jobs => jobs.filter(j => j._id !== jobId));
        this.flash('✅ تم حذف الريكويست');
      },
      error: () => this.flash('❌ فشل حذف الريكويست'),
    });
  }

  clearAllJobs(): void {
    if (!confirm('هل أنت تأكد من مسح جميع الريكويستات في صفحة الدخول؟')) return;
    this.http.delete<{ success: boolean }>(`${this.apiBase}/print/jobs/all`).subscribe({
      next: () => {
        this.printJobs.set([]);
        this.flash('✅ تم مسح جميع الريكويستات');
      },
      error: () => this.flash('❌ فشل مسح الريكويستات'),
    });
  }
}
