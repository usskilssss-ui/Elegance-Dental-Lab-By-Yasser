import { Component, Input, OnChanges } from '@angular/core';
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
  @Input() compact = false;

  path = '';
  width = 0;
  height = 44;
  label = '';
  ready = false;

  ngOnChanges(): void {
    this.render();
  }

  private render(): void {
    const text = String(this.value || '').trim();
    this.label = text;
    if (!text) {
      this.ready = false;
      this.path = '';
      return;
    }
    const moduleWidth = this.compact ? 1.2 : 1.55;
    const barHeight = this.compact ? 34 : 44;
    const svg = code128SvgPath(text, barHeight, moduleWidth);
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
