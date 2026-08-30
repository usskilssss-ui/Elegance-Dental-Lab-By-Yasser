import { CommonModule } from '@angular/common';
import { Component, HostListener, Input, inject, signal } from '@angular/core';
import { LanguageService } from '../../core/i18n/language.service';
import { TPipe } from '../../core/i18n/t.pipe';
import type { TranslationKey } from '../../core/i18n/translations';

export type AppMenuItem = {
  id: string;
  labelKey: TranslationKey | string;
  labelFallback?: string;
  action: () => void;
};

@Component({
  selector: 'app-overflow-menu',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './app-overflow-menu.html',
  styleUrl: './app-overflow-menu.css',
})
export class AppOverflowMenuComponent {
  readonly lang = inject(LanguageService);
  readonly open = signal(false);

  /** Extra page-specific actions above the language switcher */
  @Input() items: AppMenuItem[] = [];

  toggle(ev?: Event): void {
    ev?.stopPropagation();
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onItem(item: AppMenuItem, ev?: Event): void {
    ev?.stopPropagation();
    this.close();
    item.action();
  }

  setArabic(ev?: Event): void {
    ev?.stopPropagation();
    this.lang.setLang('ar');
    this.close();
  }

  setEnglish(ev?: Event): void {
    ev?.stopPropagation();
    this.lang.setLang('en');
    this.close();
  }

  @HostListener('document:click')
  onDocClick(): void {
    if (this.open()) this.close();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open()) this.close();
  }
}
