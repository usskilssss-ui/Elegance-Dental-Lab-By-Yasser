import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { PwaInstallService } from '../../core/services/pwa-install.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  email = '';
  password = '';
  pin = '';
  showPassword = false;
  rememberEmail = true;
  /** When true and email has PIN, show PIN field instead of password */
  usePinLogin = false;
  emailHasPin = false;
  loginError = '';
  submitting = false;
  public themeService = inject(ThemeService);
  public readonly pwa = inject(PwaInstallService);

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    const remembered = this.pwa.getRememberedEmail();
    if (remembered) {
      this.email = remembered;
      this.rememberEmail = true;
      this.refreshPinStatus();
    }
  }

  onEmailBlur(): void {
    this.refreshPinStatus();
  }

  refreshPinStatus(): void {
    const email = this.email.trim();
    if (!email.includes('@')) {
      this.emailHasPin = false;
      this.usePinLogin = false;
      return;
    }
    this.auth.checkPinStatus(email).subscribe((hasPin) => {
      this.emailHasPin = hasPin;
      this.usePinLogin = hasPin;
    });
  }

  switchToPassword(): void {
    this.usePinLogin = false;
    this.pin = '';
    this.loginError = '';
  }

  switchToPin(): void {
    if (!this.emailHasPin) return;
    this.usePinLogin = true;
    this.password = '';
    this.loginError = '';
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  login(): void {
    const email = this.email.trim();
    if (!email) {
      this.loginError = 'يرجى إدخال البريد الإلكتروني';
      return;
    }

    if (this.usePinLogin) {
      const pin = this.pin.trim();
      if (!/^\d{4,6}$/.test(pin)) {
        this.loginError = 'أدخل الرقم السري (4–6 أرقام)';
        return;
      }
      this.loginError = '';
      this.submitting = true;
      this.auth.loginWithPin(email, pin).subscribe({
        next: () => this.afterLoginSuccess(email),
        error: (err: unknown) => {
          this.submitting = false;
          this.loginError = this.formatLoginError(err);
        },
      });
      return;
    }

    if (!this.password) {
      this.loginError = 'يرجى إدخال البريد الإلكتروني وكلمة المرور';
      return;
    }
    this.loginError = '';
    this.submitting = true;
    this.auth.login(email, this.password).subscribe({
      next: () => this.afterLoginSuccess(email),
      error: (err: unknown) => {
        this.submitting = false;
        this.loginError = this.formatLoginError(err);
      },
    });
  }

  private afterLoginSuccess(email: string): void {
    this.submitting = false;
    if (this.rememberEmail) this.pwa.setRememberedEmail(email);
    else this.pwa.setRememberedEmail(null);

    const returnUrl = this.safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    if (returnUrl) {
      void this.router.navigateByUrl(returnUrl);
      return;
    }
    const session = this.auth.getSession();
    if (session) {
      void this.router.navigateByUrl(this.auth.homePathForRole(session.role));
    }
  }

  async installApp(): Promise<void> {
    await this.pwa.installApp();
  }

  private formatLoginError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.error?.message && typeof err.error.message === 'string') {
        return err.error.message;
      }
      if (Array.isArray(err.error?.errors) && err.error.errors[0]?.msg) {
        return err.error.errors[0].msg;
      }
      if (err.status === 401) {
        return this.usePinLogin
          ? 'الرقم السري غير صحيح'
          : 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
      }
    }
    return 'تعذر تسجيل الدخول. حاول مرة أخرى.';
  }

  private safeReturnUrl(raw: string | null): string | null {
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
      return null;
    }
    return raw;
  }
}
