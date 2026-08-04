import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppRole } from '../../core/auth/auth.types';
import { AuthService } from '../../core/services/auth.service';
import { CaseApiService } from '../../core/services/case-api.service';
import { ThemeService } from '../../core/services/theme.service';

export type ScanStation = 'reception' | 'design' | 'finishing';

type ScanFeedback = {
  ok: boolean;
  title: string;
  detail: string;
  caseNumber?: string;
  patientName?: string;
  stage?: string;
};

const ROLE_META: Partial<
  Record<AppRole, { station: ScanStation; title: string; subtitle: string }>
> = {
  scanner1: {
    station: 'reception',
    title: 'سكان 1 — الريسبشن',
    subtitle: 'من أي مرحلة → منتهية',
  },
  scanner2: {
    station: 'design',
    title: 'سكان 2 — الديزاين',
    subtitle: 'من أي مرحلة → تحت الديزاين',
  },
  scanner3: {
    station: 'finishing',
    title: 'سكان 3 — الفينيش',
    subtitle: 'من أي مرحلة → تحت الفينيش',
  },
};

@Component({
  selector: 'app-station-scan',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './station-scan.html',
  styleUrls: ['./station-scan.css'],
})
export class StationScanComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly caseApi = inject(CaseApiService);
  private readonly auth = inject(AuthService);
  readonly themeService = inject(ThemeService);

  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  readonly station = signal<ScanStation>('design');
  readonly title = signal('مسح الحالات');
  readonly subtitle = signal('');
  readonly accountName = signal('');
  readonly busy = signal(false);
  readonly feedback = signal<ScanFeedback | null>(null);
  readonly lastScans = signal<ScanFeedback[]>([]);
  readonly unauthorized = signal(false);

  scanBuffer = '';
  private focusTimer: ReturnType<typeof setInterval> | null = null;
  private clearFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const session = this.auth.getSession();
    const role = session?.role;
    this.accountName.set(session?.name || '');

    const meta = role ? ROLE_META[role] : undefined;
    if (!meta) {
      // Admin/lab staff can open /scan but need a scanner account for locked station
      if (role === 'admin' || role === 'secretary' || role === 'designer' || role === 'finisher') {
        this.unauthorized.set(false);
        this.title.set('مسح تجريبي');
        this.subtitle.set('سجّل دخول بحساب سكان 1 / 2 / 3 للاستخدام اليومي');
        this.station.set('design');
      } else {
        this.unauthorized.set(true);
      }
    } else {
      this.unauthorized.set(false);
      this.station.set(meta.station);
      this.title.set(meta.title);
      this.subtitle.set(meta.subtitle);
    }

    this.focusTimer = setInterval(() => this.focusScanner(), 800);
    setTimeout(() => this.focusScanner(), 200);
  }

  ngOnDestroy(): void {
    if (this.focusTimer) clearInterval(this.focusTimer);
    if (this.clearFeedbackTimer) clearTimeout(this.clearFeedbackTimer);
  }

  focusScanner(): void {
    if (this.busy() || this.unauthorized()) return;
    const el = this.scanInput?.nativeElement;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }

  onScanSubmit(ev?: Event): void {
    ev?.preventDefault();
    const code = this.scanBuffer.trim();
    this.scanBuffer = '';
    if (!code || this.busy() || this.unauthorized()) {
      this.focusScanner();
      return;
    }
    this.submitCode(code);
  }

  private submitCode(code: string): void {
    this.busy.set(true);
    const role = this.auth.getSession()?.role;
    const isScanner = role === 'scanner1' || role === 'scanner2' || role === 'scanner3';
    // Scanners: station comes from JWT/role on server. Others may pass station for testing.
    const station = isScanner ? undefined : this.station();
    this.caseApi.scanAtStation(code, station).subscribe({
      next: (res) => {
        this.busy.set(false);
        const c = res?.case || {};
        const fb: ScanFeedback = {
          ok: !!res?.success,
          title: res?.message || 'تم',
          detail: c.patientName
            ? `${c.caseNumber || code} — ${c.patientName}`
            : String(c.caseNumber || code),
          caseNumber: c.caseNumber,
          patientName: c.patientName,
          stage: c.currentStage,
        };
        this.pushFeedback(fb);
        this.playTone(true);
        this.focusScanner();
      },
      error: (err) => {
        this.busy.set(false);
        const fb: ScanFeedback = {
          ok: false,
          title: err?.error?.message || 'فشل المسح',
          detail: code,
          caseNumber: err?.error?.case?.caseNumber,
          patientName: err?.error?.case?.patientName,
          stage: err?.error?.case?.currentStage,
        };
        this.pushFeedback(fb);
        this.playTone(false);
        this.focusScanner();
      },
    });
  }

  private pushFeedback(fb: ScanFeedback): void {
    this.feedback.set(fb);
    this.lastScans.update((list) => [fb, ...list].slice(0, 8));
    if (this.clearFeedbackTimer) clearTimeout(this.clearFeedbackTimer);
    this.clearFeedbackTimer = setTimeout(() => this.feedback.set(null), 5000);
  }

  private playTone(ok: boolean): void {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = ok ? 880 : 220;
      gain.gain.value = 0.08;
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, ok ? 140 : 320);
    } catch {
      /* ignore */
    }
  }

  logout(): void {
    this.auth.performLogout(this.router);
  }
}
