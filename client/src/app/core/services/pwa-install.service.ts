import { Injectable, signal } from '@angular/core';

const REMEMBER_EMAIL_KEY = 'dental_remember_email';
const INSTALL_HINT_DISMISSED_KEY = 'dental_pwa_install_hint_dismissed';

/** Chromium custom event for install prompt */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  readonly canInstall = signal(false);
  readonly isStandalone = signal(false);
  readonly isInAppBrowser = signal(false);
  readonly showInstallHint = signal(false);
  readonly copied = signal(false);
  readonly installing = signal(false);
  /** True while waiting for Chrome to offer the native install event */
  readonly preparingInstall = signal(false);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    this.isStandalone.set(this.detectStandalone());
    this.isInAppBrowser.set(this.detectInAppBrowser());

    const dismissed = localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === '1';
    const wantHint = !this.isStandalone() && !dismissed && this.isMobile();
    this.showInstallHint.set(wantHint);

    // Coming from WhatsApp → Chrome with ?install=1 : force show install CTA
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('install') === '1' && wantHint) {
        this.showInstallHint.set(true);
      }
    } catch {
      /* ignore */
    }

    if (wantHint && this.isAndroid() && !this.isInAppBrowser()) {
      this.preparingInstall.set(true);
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
      this.preparingInstall.set(false);
      if (!dismissed) this.showInstallHint.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.preparingInstall.set(false);
      this.showInstallHint.set(false);
      this.isStandalone.set(true);
      this.installing.set(false);
      this.clearInstallQuery();
    });

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready
        .then(() => {
          // Give Chrome a moment to fire beforeinstallprompt after SW is ready
          window.setTimeout(() => {
            if (!this.deferredPrompt) this.preparingInstall.set(false);
          }, 12000);
        })
        .catch(() => this.preparingInstall.set(false));
    }
  }

  getRememberedEmail(): string {
    try {
      return localStorage.getItem(REMEMBER_EMAIL_KEY) || '';
    } catch {
      return '';
    }
  }

  setRememberedEmail(email: string | null): void {
    try {
      if (email?.trim()) localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      else localStorage.removeItem(REMEMBER_EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }

  dismissInstallHint(): void {
    try {
      localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
    this.showInstallHint.set(false);
  }

  isIos(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  isAndroid(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /android/i.test(navigator.userAgent);
  }

  isMobile(): boolean {
    if (typeof navigator === 'undefined') return false;
    return this.isIos() || this.isAndroid() || /Mobile|webOS/i.test(navigator.userAgent);
  }

  appUrl(): string {
    return typeof location !== 'undefined' ? `${location.origin}/login` : '';
  }

  /** Chrome URL that auto-opens the install banner flow */
  installDeepLink(): string {
    const url = new URL(this.appUrl());
    url.searchParams.set('install', '1');
    return url.toString();
  }

  async copyAppLink(): Promise<void> {
    const url = this.appUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      /* ignore */
    }
  }

  openInSystemBrowser(): void {
    const target = this.installDeepLink();
    if (this.isAndroid()) {
      const hostPath = target.replace(/^https?:\/\//, '');
      window.location.href =
        `intent://${hostPath}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target)};end`;
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  /**
   * One doctor tap → native Android install sheet (must stay in user gesture).
   */
  async installApp(): Promise<boolean> {
    if (this.isStandalone()) {
      this.showInstallHint.set(false);
      return true;
    }

    // Inside WhatsApp: jump to Chrome with ?install=1 (one tap from doctor)
    if (this.isInAppBrowser()) {
      this.openInSystemBrowser();
      return false;
    }

    const promptEvent = this.deferredPrompt;
    if (promptEvent) {
      this.installing.set(true);
      // Keep event until prompt succeeds; clear after calling prompt()
      this.deferredPrompt = null;
      this.canInstall.set(false);
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        this.installing.set(false);
        if (choice.outcome === 'accepted') {
          this.showInstallHint.set(false);
          this.clearInstallQuery();
          return true;
        }
        // If dismissed, Chrome won't re-fire event — hide noisy spinner
        return false;
      } catch {
        this.installing.set(false);
        return false;
      }
    }

    // Not ready yet on Android Chrome — open same page fresh (helps SW/prompt)
    if (this.isAndroid()) {
      this.preparingInstall.set(true);
      window.location.href = this.installDeepLink();
      return false;
    }

    // iOS: share sheet (system UI includes Add to Home Screen)
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      this.installing.set(true);
      try {
        await navigator.share({
          title: 'Elegance Dental Lab',
          url: this.appUrl(),
        });
        this.installing.set(false);
        return true;
      } catch {
        this.installing.set(false);
        return false;
      }
    }

    this.installing.set(false);
    return false;
  }

  /** @deprecated use installApp */
  async promptInstall(): Promise<boolean> {
    return this.installApp();
  }

  private clearInstallQuery(): void {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('install')) return;
      url.searchParams.delete('install');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }

  private detectStandalone(): boolean {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      nav.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  private detectInAppBrowser(): boolean {
    const ua = navigator.userAgent || '';
    return (
      /FBAN|FBAV|Instagram|Line\//i.test(ua) ||
      /WhatsApp/i.test(ua) ||
      (/Android/i.test(ua) && /wv\)/i.test(ua) && /Version\/[\d.]+/i.test(ua))
    );
  }
}
