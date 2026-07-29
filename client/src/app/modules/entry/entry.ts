import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { SharedCasesService } from '../../core/services/shared-cases.service';
import { mapApiCaseToDentalCase } from '../../core/mappers/dental-case-api.mapper';
import { Subscription } from 'rxjs';
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
  };
  status: 'pending' | 'printing' | 'done' | 'failed';
  paperConfirmed?: 'pending' | 'yes' | 'no';
  errorMessage?: string;
  createdAt: string;
}

@Component({
  selector: 'app-entry',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './entry.html',
  styleUrl: './entry.css',
})
export class EntryComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly caseApi = inject(CaseApiService);
  private readonly sharedCases = inject(SharedCasesService);
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

  // Doctor autocomplete
  readonly showDoctorSuggestions = signal(false);
  readonly activeSuggestionIndex = signal(-1);
  private doctorSearchQuery = '';

  get filteredDoctors(): string[] {
    const allCases = this.sharedCases.cases();
    const doctors = Array.from(new Set(
      allCases.map(c => c.doctor?.trim()).filter((n): n is string => !!n)
    )).sort();
    const q = this.normalizeArabic(this.doctorSearchQuery);
    if (!q) return doctors.slice(0, 10);
    return doctors.filter(d => this.normalizeArabic(d).includes(q));
  }

  normalizeArabic(text: string): string {
    if (!text) return '';
    return text.trim()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ');
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
    // Load doctor suggestions
    this.caseApi.getAllCases(1, 3000).subscribe({
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
    this.jobsPollTimer = setInterval(() => this.loadTodayJobs({ silent: true }), 15000);

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
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  save(): void {
    const d = this.formDraft;

    if (!d.doctor.trim()) { this.flash('يرجى تعبئة اسم الطبيب'); return; }
    if (!d.patient?.trim()) { this.flash('يرجى إدخال اسم المريض'); return; }
    if (d.caseType !== 'Empty' && this.selectedWorkTypes.size === 0) {
      this.workTypeError = 'يرجى اختيار نوع عمل واحد على الأقل';
      this.flash('يرجى اختيار نوع العمل');
      return;
    }

    const createdCase = {
      ...d,
      caseNumber: d.caseNumber ? d.caseNumber.trim() : '',
      doctor: d.doctor.trim(),
      patient: d.patient.trim(),
      workType: d.workType.trim(),
      workDetail: (d.workDetail || '').trim(),
      color: (d.color || '').trim(),
      quantity: d.caseType === 'Empty' ? 0 : (d.quantity || 1),
    };

    this.closeDialog();
    this.saveInProgress.set(true);

    const now = new Date();
    const printDate = now.toLocaleDateString('en-GB') + '  ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Send to remote Print Agent API
    this.http.post(`${this.apiBase}/print/job`, {
      printData: { ...createdCase, printDate },
    }).subscribe({
      next: () => {
        this.saveInProgress.set(false);
        this.flash('✅ تم إرسال الريكويست للطباعة');
        // Refresh today's jobs list
        this.loadTodayJobs();
      },
      error: () => {
        this.saveInProgress.set(false);
        this.flash('❌ فشل إرسال الريكويست، تحقق من الاتصال');
      }
    });

    // Also trigger local popup print as fallback
    setTimeout(() => this.printCaseCard(createdCase), 100);
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
    if (!wt) return '';
    if (wt === 'Empty') return 'غير معروف';
    if (wt === 'Modification') return 'تعديل';
    if (wt === 'Redo' || wt === 'Remake') return 'اعادة';
    let display = wt;
    if (display.startsWith('Modification - ')) display = display.replace('Modification - ', 'تعديل - ');
    else if (display.startsWith('Redo - ')) display = display.replace('Redo - ', 'اعادة - ');
    return display;
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

  reprintJob(job: PrintJobCard): void {
    this.printCaseCard(job.printData);
    this.flash('🖨️ جاري إعادة الطباعة...');
  }

  printCaseCard(c: any): void {
    const now = new Date();
    const printDate = now.toLocaleDateString('en-GB') + '  ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const workTypeDisplay = this.formatWorkTypeForDisplay(c.workType);
    const quantity = c.caseType === 'Empty' ? 0 : (c.quantity || 0);

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>ريكويست</title>
  <style>
    @page { margin: 75mm 20mm 15mm 20mm; size: A4; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    html { height: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 0; background: #fff; color: #000; font-size: 19px; }
    .section { margin: 22px 0; }
    .section-title { font-size: 17px; font-weight: bold; border-right: 4px solid #000; padding-right: 12px; margin-bottom: 12px; color: #222; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; font-size: 18px; }
    .row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: bold; text-align: left; }
    .footer { margin-top: 30px; padding-top: 14px; border-top: 2px solid #000; display: flex; justify-content: space-between; font-size: 15px; color: #555; }
    .teeth-section { margin-top: 36px; }
    .teeth-title { font-size: 17px; font-weight: bold; border-right: 4px solid #000; padding-right: 12px; margin-bottom: 14px; color: #222; }
    .teeth-table { width: 100%; border-collapse: collapse; font-size: 17px; }
    .teeth-table th { background: #f0f0f0; color: #333; text-align: center; padding: 8px 0; font-size: 18px; font-weight: bold; width: 50%; border: 1px solid #ccc; }
    .teeth-table td { text-align: center; padding: 10px 2px; font-size: 18px; font-weight: bold; width: 6.25%; }
    .teeth-table .divider td { border-top: 2px solid #333; padding: 0; height: 0; }
    .center-line { border-right: 2px solid #333; }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">بيانات الطبيب والمريض</div>
    <div class="row"><span class="label">الطبيب</span><span class="value">${c.doctor || '—'}</span></div>
    <div class="row"><span class="label">المريض</span><span class="value">${c.patient || '—'}</span></div>
    <div class="row"><span class="label">الفرع</span><span class="value">${c.branch || '—'}</span></div>
  </div>
  <div class="section">
    <div class="section-title">تفاصيل العمل</div>
    <div class="row"><span class="label">نوع العمل</span><span class="value">${workTypeDisplay || '—'}</span></div>
    ${c.workDetail ? `<div class="row"><span class="label">ملاحظات</span><span class="value">${c.workDetail}</span></div>` : ''}
    <div class="row"><span class="label">اللون</span><span class="value">${c.color || '—'}</span></div>
    <div class="row"><span class="label">إجمالي العدد</span><span class="value">${quantity}</span></div>
  </div>
  <div class="teeth-section">
    <div class="teeth-title">مخطط الأسنان</div>
    <table class="teeth-table" dir="ltr">
      <thead><tr><th colspan="8">R</th><th colspan="8">L</th></tr></thead>
      <tbody>
        <tr>
          <td>8</td><td>7</td><td>6</td><td>5</td><td>4</td><td>3</td><td>2</td><td class="center-line">1</td>
          <td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td>
        </tr>
        <tr class="divider"><td colspan="16"></td></tr>
        <tr>
          <td>8</td><td>7</td><td>6</td><td>5</td><td>4</td><td>3</td><td>2</td><td class="center-line">1</td>
          <td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="footer">
    <span>تاريخ الطباعة: ${c.printDate || printDate}</span>
    <span>Elegance Dental Lab</span>
  </div>
  <script>
    window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };
  </script>
</body>
</html>`;

    const popup = window.open('', '_blank', 'width=800,height=900,toolbar=0,menubar=0,scrollbars=0');
    if (popup) {
      popup.document.write(html);
      popup.document.close();
    }
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
