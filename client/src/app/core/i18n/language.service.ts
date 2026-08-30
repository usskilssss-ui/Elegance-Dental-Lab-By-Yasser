import { Injectable, computed, signal } from '@angular/core';
import { TRANSLATIONS, type AppLang, type TranslationKey } from './translations';

const STORAGE_KEY = 'app-lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly lang = signal<AppLang>(this.readStored());
  readonly dir = computed(() => (this.lang() === 'ar' ? 'rtl' : 'ltr'));
  readonly isArabic = computed(() => this.lang() === 'ar');
  readonly isEnglish = computed(() => this.lang() === 'en');

  constructor() {
    this.applyToDom(this.lang());
  }

  t(key: TranslationKey | string, fallback?: string): string {
    const table = TRANSLATIONS[this.lang()] || TRANSLATIONS.ar;
    return table[key as TranslationKey] || TRANSLATIONS.ar[key as TranslationKey] || fallback || key;
  }

  setLang(lang: AppLang): void {
    if (lang !== 'ar' && lang !== 'en') return;
    this.lang.set(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    this.applyToDom(lang);
  }

  toggleLang(): void {
    this.setLang(this.lang() === 'ar' ? 'en' : 'ar');
  }

  private readStored(): AppLang {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ar') return saved;
    } catch {
      /* ignore */
    }
    return 'ar';
  }

  private applyToDom(lang: AppLang): void {
    if (typeof document === 'undefined') return;
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.body?.setAttribute('dir', dir);
    document.body?.classList.toggle('lang-en', lang === 'en');
    document.body?.classList.toggle('lang-ar', lang === 'ar');
  }
}
