import { ApplicationRef, Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, filter, first, interval, of, switchMap } from 'rxjs';

/**
 * Force-activate new deploys so entry PCs don't keep an old cached bundle
 * (old entry code browser-printed + agent-printed = two different formats).
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  start(): void {
    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(async () => {
        try {
          await this.updates.activateUpdate();
        } catch {
          /* ignore */
        }
        document.location.reload();
      });

    // Check once app is stable, then every 60s
    this.appRef.isStable
      .pipe(
        first((stable) => stable === true),
        switchMap(() => concat(of(0), interval(60_000)))
      )
      .subscribe(() => {
        this.updates.checkForUpdate().catch(() => undefined);
      });
  }
}
