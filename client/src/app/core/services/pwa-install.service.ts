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

  constructor() {
    if (typeof window === 'undefined') return;

    this.isStandalone.set(this.detectStandalone());
    this.isInAppBrowser.set(this.detectInAppBrowser());

    const dismissed = localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === '1';
    this.showInstallHint.set(!this.isStandalone() && !dismissed && this.isMobile());

    // Capture install event as soon as Chrome offers it
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
      if (!dismissed) this.showInstallHint.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.showInstallHint.set(false);
      this.isStandalone.set(true);
      this.installing.set(false);
    });

    // Ensure SW is ready ASAP (needed for beforeinstallprompt on Android)
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.catch(() => undefined);
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
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
      const hostPath = url.replace(/^https?:\/\//, '');
      window.location.href =
        `intent://${hostPath}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Install must stay in the same user-gesture turn as the click.
   * Never await long work before deferredPrompt.prompt().
   */
  async installApp(): Promise<boolean> {
    if (this.isStandalone()) {
      this.showInstallHint.set(false);
      return true;
    }

    // WhatsApp/Facebook webview cannot install — jump to Chrome first
    if (this.isInAppBrowser()) {
      this.openInSystemBrowser();
      return false;
    }

    const promptEvent = this.deferredPrompt;
    if (promptEvent) {
      this.installing.set(true);
      this.deferredPrompt = null;
      this.canInstall.set(false);
      try {
        // Must call promptly after click (user gesture)
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

    // iOS / Safari: open share sheet (includes Add to Home Screen)
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      this.installing.set(true);
      try {
        await navigator.share({
          title: 'Elegance Dental Lab',
          text: 'Elegance Dental Lab',
          url: this.appUrl(),
        });
        this.installing.set(false);
        return true;
      } catch {
        this.installing.set(false);
        // user cancelled share
        return false;
      }
    }

    // Android Chrome without prompt yet: open clean Chrome tab of the app
    if (this.isAndroid()) {
      this.openInSystemBrowser();
      return false;
    }

    this.installing.set(false);
    return false;
  }

  /** @deprecated use installApp */
  async promptInstall(): Promise<boolean> {
    return this.installApp();
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
