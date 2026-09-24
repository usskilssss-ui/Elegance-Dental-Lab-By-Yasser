import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';

/** Live Elegance API. Keep this literal in the bundle — Vercel /api is the Angular app, not Express. */
const RAILWAY_API =
  'https://elegance-dental-lab-by-yasser-production-da7c.up.railway.app/api';

@Injectable()
export class RailwayApiInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.url.includes('localhost')) {
      return next.handle(req);
    }
    const q = req.url.indexOf('?');
    const pathOnly = q >= 0 ? req.url.slice(0, q) : req.url;
    const query = q >= 0 ? req.url.slice(q) : '';
    const apiAt = pathOnly.lastIndexOf('/api');
    if (apiAt < 0) {
      return next.handle(req);
    }
    const after = pathOnly.slice(apiAt + 4);
    const dest = `${RAILWAY_API}${after}${query}`;
    if (dest === req.url) {
      return next.handle(req);
    }
    return next.handle(req.clone({ url: dest }));
  }
}
