import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { SwUpdateService } from './app/core/services/sw-update.service';

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    appRef.injector.get(SwUpdateService).start();
  })
  .catch((err) => console.error(err));
