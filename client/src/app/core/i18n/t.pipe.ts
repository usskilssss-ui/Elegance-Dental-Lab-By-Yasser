import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from './language.service';
import type { TranslationKey } from './translations';

@Pipe({
  name: 't',
  standalone: true,
  pure: false,
})
export class TPipe implements PipeTransform {
  private readonly lang = inject(LanguageService);

  transform(key: TranslationKey | string, fallback?: string): string {
    // Depend on lang signal so impure pipe refreshes when language changes
    this.lang.lang();
    return this.lang.t(key, fallback);
  }
}
