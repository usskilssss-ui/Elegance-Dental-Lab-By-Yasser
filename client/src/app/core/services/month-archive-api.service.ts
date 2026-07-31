import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class MonthArchiveApiService {
  private apiUrl = `${environment.apiUrl}/month-archive`;

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  listArchives(): Observable<any> {
    return this.http.get(`${this.apiUrl}`);
  }

  closeMonth(payload: {
    year: number;
    month: number;
    confirm: string;
    force?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.apiUrl}/close`, payload);
  }

  /**
   * Download ZIP via fetch (more reliable than HttpClient blob + delayed <a click>).
   */
  exportZip(year?: number | null, month?: number | null): Observable<Blob> {
    const params: string[] = [];
    if (year && month) {
      params.push(`year=${year}`);
      params.push(`month=${month}`);
    }
    const query = params.length ? `?${params.join('&')}` : '';
    const url = `${this.apiUrl}/export${query}`;
    const token = this.auth.getToken();

    return from(
      (async () => {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/zip, application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        const buffer = await res.arrayBuffer();
        const contentType = res.headers.get('content-type') || '';

        // If server returned JSON error, surface it
        if (!res.ok || contentType.includes('application/json')) {
          let message = `فشل التحميل (${res.status || 'network'})`;
          try {
            const text = new TextDecoder().decode(buffer);
            const parsed = JSON.parse(text);
            message = String(parsed?.message || parsed?.error || message);
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }

        // ZIP files start with PK
        const head = new Uint8Array(buffer.slice(0, 2));
        if (head.length < 2 || head[0] !== 0x50 || head[1] !== 0x4b) {
          throw new Error('الملف المستلم مش ZIP صالح — استنى تحديث السيرفر وجرّب تاني');
        }

        return new Blob([buffer], { type: 'application/zip' });
      })()
    );
  }

  /** Fallback HttpClient export (unused; kept for compatibility). */
  exportZipHttp(year?: number | null, month?: number | null): Observable<Blob> {
    const params: string[] = [];
    if (year && month) {
      params.push(`year=${year}`);
      params.push(`month=${month}`);
    }
    const query = params.length ? `?${params.join('&')}` : '';
    return this.http.get(`${this.apiUrl}/export${query}`, {
      responseType: 'blob',
      headers: new HttpHeaders({ Accept: 'application/zip' }),
    });
  }
}
