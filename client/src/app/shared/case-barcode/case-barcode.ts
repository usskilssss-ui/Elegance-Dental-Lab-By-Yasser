import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { code128SvgPath } from '../../core/utils/code128';

@Component({
  selector: 'app-case-barcode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './case-barcode.html',
  styleUrl: './case-barcode.css',
})
export class CaseBarcodeComponent implements OnChanges, OnDestroy {
  /** Encoded value — must be the human caseNumber (CASE-YYYY-NNNNN). */
  @Input({ required: true }) value = '';
  /** Kept for API compat; trigger is always compact. */
  @Input() compact = false;

  @ViewChild('overlay') overlayRef?: ElementRef<HTMLElement>;

  private readonly document = inject(DOCUMENT);

  path = '';
  width = 0;
  height = 56;
  label = '';
  ready = false;
  open = false;

  ngOnChanges(): void {
    this.render();
  }

  ngOnDestroy(): void {
    const el = this.overlayRef?.nativeElement;
    if (el?.isConnected && el.parentElement === this.document.body) {
      el.remove();
    }
    this.unlockBodyScroll();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  openBarcode(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.ready) return;
    this.open = true;
    this.lockBodyScroll();
    // Move overlay to <body> so parent card transforms don't trap position:fixed
    queueMicrotask(() => {
      const el = this.overlayRef?.nativeElement;
      if (el && el.parentElement !== this.document.body) {
        this.document.body.appendChild(el);
      }
    });
  }

  close(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.unlockBodyScroll();
    this.open = false;
  }

  private lockBodyScroll(): void {
    this.document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    this.document.body.style.overflow = '';
  }

  private render(): void {
    const text = String(this.value || '').trim();
    this.label = text;
    if (!text) {
      this.ready = false;
      this.path = '';
      return;
    }
    const svg = code128SvgPath(text, 64, 2);
    if (!svg) {
      this.ready = false;
      this.path = '';
      return;
    }
    this.path = svg.path;
    this.width = svg.width;
    this.height = svg.height;
    this.ready = true;
  }
}
