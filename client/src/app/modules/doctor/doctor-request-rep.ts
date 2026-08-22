import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-doctor-request-rep',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './doctor-request-rep.html',
  styleUrls: ['./doctor-request-rep.css'],
})
export class DoctorRequestRepComponent implements OnInit {
  private readonly auth = inject(AuthService);
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

  ngOnInit(): void {
    const as = (this.route.snapshot.queryParamMap.get('as') || '').trim();
    const role = this.auth.getSession()?.role;
    this.viewingAsDoctor.set(role === 'admin' && as ? as : null);
  }

  backToDashboard(): void {
    const as = this.viewingAsDoctor()?.trim();
    this.router.navigate(['/doctor/dashboard'], {
      queryParams: as && this.auth.getSession()?.role === 'admin' ? { as } : {},
    });
  }
}
