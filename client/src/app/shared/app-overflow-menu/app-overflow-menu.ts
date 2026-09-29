import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  ViewChild,
  ViewEncapsulation,
  inject,
  signal,
} from '@angular/core';
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
  encapsulation: ViewEncapsulation.None,
})
export class AppOverflowMenuComponent {
  readonly lang = inject(LanguageService);
  readonly open = signal(false);
  readonly panelStyle = signal<Record<string, string>>({});

  @ViewChild('menuBtn') menuBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('menuPanel') menuPanel?: ElementRef<HTMLDivElement>;

  /** Extra page-specific actions above the language switcher */
  @Input() items: AppMenuItem[] = [];

  private positionTimer: ReturnType<typeof setTimeout> | null = null;

  toggle(ev?: Event): void {
    ev?.stopPropagation();
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.panelStyle.set({
        top: '0px',
        left: '0px',
        opacity: '0',
        pointerEvents: 'none',
      });
      if (this.positionTimer) clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => this.positionPanel(), 0);
    } else {
      this.panelStyle.set({});
    }
  }

  close(): void {
    if (this.positionTimer) {
      clearTimeout(this.positionTimer);
      this.positionTimer = null;
    }
    this.open.set(false);
    this.panelStyle.set({});
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

  @HostListener('window:resize')
  onResize(): void {
    if (this.open()) this.positionPanel();
  }

  private positionPanel(): void {
    const btn = this.menuBtn?.nativeElement;
    const panel = this.menuPanel?.nativeElement;
    if (!btn || !panel || !this.open()) return;

    const margin = 8;
    const btnRect = btn.getBoundingClientRect();
    const panelW = Math.max(panel.offsetWidth || 260, 260);
    const panelH = Math.max(panel.offsetHeight || 160, 120);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = btnRect.bottom + margin;
    if (top + panelH > vh - margin) {
      top = Math.max(margin, btnRect.top - panelH - margin);
    }

    // Keep fully on-screen whether the trigger sits on the left (AR) or right (EN)
    let left = btnRect.left;
    if (left + panelW > vw - margin) {
      left = btnRect.right - panelW;
    }
    left = Math.max(margin, Math.min(left, vw - panelW - margin));
    top = Math.max(margin, Math.min(top, vh - panelH - margin));

    this.panelStyle.set({
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      opacity: '1',
      pointerEvents: 'auto',
    });
  }
}
