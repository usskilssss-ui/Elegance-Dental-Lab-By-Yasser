import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { ThemeService } from '../../core/services/theme.service';

export type DoctorExitedMaterialRow = {
  key: string;
  label: string;
  count: number;
};

export type DoctorExitedMaterialsSummary = {
  doctorName: string;
  totalUnits: number;
  caseCount: number;
  materials: DoctorExitedMaterialRow[];
};

const ARABIC_LOAD_ERROR = 'تعذر تحميل عدد الماتريال الخارجة. حاول مرة أخرى.';

@Component({
  selector: 'app-doctor-exited-materials',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './doctor-exited-materials.html',
  styleUrls: ['./doctor-exited-materials.css'],
})
export class DoctorExitedMaterialsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly caseApi = inject(CaseApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly themeService = inject(ThemeService);

  readonly viewingAsDoctor = signal<string | null>(null);
  readonly isAdminView = computed(() => {
    const role = this.auth.getSession()?.role;
    return role === 'admin' && !!this.viewingAsDoctor();
  });
  readonly doctorName = computed(() => {
    const fromApi = this.summary()?.doctorName?.trim();
    if (fromApi) return fromApi;
    const as = this.viewingAsDoctor()?.trim();
    if (as && this.auth.getSession()?.role === 'admin') return as;
    return this.auth.getSession()?.name?.trim() || '—';
  });

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly summary = signal<DoctorExitedMaterialsSummary | null>(null);

  ngOnInit(): void {
    const as = (this.route.snapshot.queryParamMap.get('as') || '').trim();
    const role = this.auth.getSession()?.role;
    const adminAs = role === 'admin' && as ? as : null;
    this.viewingAsDoctor.set(adminAs);

    // Doctors must not keep a stale/garbled ?as= in the URL (admin-only portal param).
    if (role !== 'admin' && as) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }

    this.loadSummary();
  }

  backToDashboard(): void {
    const as = this.viewingAsDoctor()?.trim();
    this.router.navigate(['/doctor/dashboard'], {
      queryParams: as && this.auth.getSession()?.role === 'admin' ? { as } : {},
    });
  }

  retry(): void {
    this.loadSummary();
  }

  formatCount(value: number | null | undefined): string {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toLocaleString('en-EG');
  }

  private friendlyError(err: any): string {
    const status = Number(err?.status);
    const raw = String(err?.error?.message || err?.message || '').trim();
    // Missing backend route hits GET /:id → CastError → "Failed to fetch case"
    if (
      !raw ||
      /failed to fetch case/i.test(raw) ||
      /case not found/i.test(raw) ||
      status === 404 ||
      status === 0
    ) {
      return ARABIC_LOAD_ERROR;
    }
    if (/failed to fetch doctor exited materials/i.test(raw)) {
      return ARABIC_LOAD_ERROR;
    }
    if (/query parameter doctor is required/i.test(raw) || /doctor name is required/i.test(raw)) {
      return 'يرجى فتح صفحة الدكتور من لوحة الأدمن ثم إعادة المحاولة.';
    }
    if (status === 401 || status === 403 || /access denied/i.test(raw) || /not authenticated/i.test(raw)) {
      return 'انتهت الجلسة أو لا يوجد صلاحية. سجّل الدخول مجددًا.';
    }
    // Prefer Arabic; avoid leaking English infra messages.
    if (/[\u0600-\u06FF]/.test(raw)) return raw;
    return ARABIC_LOAD_ERROR;
  }

  private loadSummary(): void {
    this.loading.set(true);
    this.error.set(null);
    const filters: { doctor?: string } = {};
    if (this.isAdminView()) {
      const as = this.viewingAsDoctor()?.trim();
      if (as) filters.doctor = as;
    }
    this.caseApi.getDoctorExitedMaterials(filters).subscribe({
      next: (res) => {
        this.summary.set((res?.data as DoctorExitedMaterialsSummary) ?? null);
        this.loading.set(false);
      },
      error: (err) => {
        this.summary.set(null);
        this.loading.set(false);
        this.error.set(this.friendlyError(err));
      },
    });
  }
}
