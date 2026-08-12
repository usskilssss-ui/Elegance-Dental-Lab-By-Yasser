import { Component, HostListener, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { code128SvgPath } from '../../core/utils/code128';

@Component({
  selector: 'app-case-barcode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './case-barcode.html',
  styleUrl: './case-barcode.css',
})
export class CaseBarcodeComponent implements OnChanges {
  /** Encoded value — must be the human caseNumber (CASE-YYYY-NNNNN). */
  @Input({ required: true }) value = '';
  /** Kept for API compat; trigger is always compact. */
  @Input() compact = false;

  path = '';
  width = 0;
  height = 56;
  label = '';
  ready = false;
  open = false;

  ngOnChanges(): void {
    this.render();
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
  }

  close(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.open = false;
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
