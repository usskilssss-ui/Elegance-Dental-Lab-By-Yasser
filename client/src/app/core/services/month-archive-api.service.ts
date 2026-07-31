import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class MonthArchiveApiService {
  private apiUrl = `${environment.apiUrl}/month-archive`;

  constructor(private http: HttpClient) {}

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

  /** Downloads ZIP blob for selected year/month (or all if omitted). */
  exportZip(year?: number | null, month?: number | null): Observable<Blob> {
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
