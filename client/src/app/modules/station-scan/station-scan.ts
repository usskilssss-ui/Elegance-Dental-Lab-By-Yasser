import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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

const STATION_META: Record<
  ScanStation,
  { title: string; subtitle: string; stageHint: string }
> = {
  design: {
    title: 'مسح الديزاين',
    subtitle: 'من الجديدة → الديزاين',
    stageHint: 'design',
  },
  finishing: {
    title: 'مسح الفينيش',
    subtitle: 'من الديزاين → الفينيش',
    stageHint: 'finishing',
  },
  reception: {
    title: 'مسح الريسبشن',
    subtitle: 'من الفينيش → منتهية',
    stageHint: 'completed',
  },
};

@Component({
  selector: 'app-station-scan',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './station-scan.html',
  styleUrls: ['./station-scan.css'],
})
export class StationScanComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly caseApi = inject(CaseApiService);
  private readonly auth = inject(AuthService);
  readonly themeService = inject(ThemeService);

  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  readonly station = signal<ScanStation>('design');
  readonly meta = signal(STATION_META.design);
  readonly busy = signal(false);
  readonly feedback = signal<ScanFeedback | null>(null);
  readonly lastScans = signal<ScanFeedback[]>([]);

  scanBuffer = '';
  private focusTimer: ReturnType<typeof setInterval> | null = null;
  private clearFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const raw = String(this.route.snapshot.paramMap.get('station') || 'design').toLowerCase();
    const station: ScanStation =
      raw === 'reception' || raw === 'finishing' || raw === 'design' ? raw : 'design';
    this.station.set(station);
    this.meta.set(STATION_META[station]);

    this.focusTimer = setInterval(() => this.focusScanner(), 800);
    setTimeout(() => this.focusScanner(), 200);
  }

  ngOnDestroy(): void {
    if (this.focusTimer) clearInterval(this.focusTimer);
    if (this.clearFeedbackTimer) clearTimeout(this.clearFeedbackTimer);
  }

  focusScanner(): void {
    if (this.busy()) return;
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
    if (!code || this.busy()) {
      this.focusScanner();
      return;
    }
    this.submitCode(code);
  }

  private submitCode(code: string): void {
    this.busy.set(true);
    this.caseApi.scanAtStation(code, this.station()).subscribe({
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

  goHome(): void {
    const role = this.auth.getSession()?.role;
    void this.router.navigateByUrl(this.auth.homePathForRole(role || 'secretary'));
  }

  logout(): void {
    this.auth.performLogout(this.router);
  }
}
