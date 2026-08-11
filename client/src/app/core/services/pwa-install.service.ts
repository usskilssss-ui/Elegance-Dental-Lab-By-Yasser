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

  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private promptWaiters: Array<(ok: boolean) => void> = [];

  constructor() {
    if (typeof window === 'undefined') return;

    this.isStandalone.set(this.detectStandalone());
    this.isInAppBrowser.set(this.detectInAppBrowser());

    const dismissed = localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === '1';
    this.showInstallHint.set(!this.isStandalone() && !dismissed && this.isMobile());

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
      if (!dismissed) this.showInstallHint.set(true);
      const waiters = this.promptWaiters.splice(0);
      waiters.forEach((w) => w(true));
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.showInstallHint.set(false);
      this.isStandalone.set(true);
      this.installing.set(false);
    });
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
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
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
    const url = this.appUrl();
    if (this.isAndroid()) {
      // Open in Chrome so native PWA install works
      const hostPath = url.replace(/^https?:\/\//, '');
      window.location.href =
        `intent://${hostPath}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * One-tap install: opens native browser install sheet when available.
   * On Android in-app browsers (WhatsApp), opens Chrome first so install can run.
   */
  async installApp(): Promise<boolean> {
    if (this.isStandalone()) return true;

    // WhatsApp / Instagram webview cannot install PWAs — jump to Chrome
    if (this.isInAppBrowser() && this.isAndroid()) {
      this.openInSystemBrowser();
      return false;
    }

    this.installing.set(true);
    try {
      if (!this.deferredPrompt) {
        await this.waitForInstallPrompt(8000);
      }
      if (!this.deferredPrompt) {
        this.installing.set(false);
        return false;
      }
      const promptEvent = this.deferredPrompt;
      this.deferredPrompt = null;
      this.canInstall.set(false);
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      this.installing.set(false);
      if (choice.outcome === 'accepted') {
        this.showInstallHint.set(false);
        return true;
      }
      return false;
    } catch {
      this.installing.set(false);
      return false;
    }
  }

  /** @deprecated use installApp */
  async promptInstall(): Promise<boolean> {
    return this.installApp();
  }

  private waitForInstallPrompt(timeoutMs: number): Promise<boolean> {
    if (this.deferredPrompt) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.promptWaiters = this.promptWaiters.filter((w) => w !== onReady);
        resolve(false);
      }, timeoutMs);
      const onReady = (ok: boolean) => {
        window.clearTimeout(timer);
        resolve(ok);
      };
      this.promptWaiters.push(onReady);
    });
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
