import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { SwUpdateService } from './core/services/sw-update.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('client');
  private readonly auth = inject(AuthService);
  readonly swUpdate = inject(SwUpdateService);

  /** Exposed for template: hide router until JWT/session bootstrap finishes. */
  protected readonly authReady = this.auth.bootstrapComplete;
}
