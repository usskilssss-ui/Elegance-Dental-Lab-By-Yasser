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
    this.viewingAsDoctor.set(role === 'admin' && as ? as : null);
    this.loadSummary();
  }

  backToDashboard(): void {
    const as = this.viewingAsDoctor()?.trim();
    this.router.navigate(['/doctor/dashboard'], {
      queryParams: as && this.auth.getSession()?.role === 'admin' ? { as } : {},
    });
  }

  formatCount(value: number | null | undefined): string {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toLocaleString('en-EG');
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
        this.error.set(err?.error?.message || 'تعذر تحميل عدد الماتريال الخارجة');
      },
    });
  }
}
