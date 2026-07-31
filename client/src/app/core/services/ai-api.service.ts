import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class AiApiService {
  private apiUrl = `${environment.apiUrl}/ai`;

  constructor(private http: HttpClient) {}

  askAssistant(question: string, year?: number | null, month?: number | null): Observable<any> {
    const params = [`question=${encodeURIComponent(question)}`];
    if (year) params.push(`year=${year}`);
    if (month) params.push(`month=${month}`);
    return this.http.get(`${this.apiUrl}/assistant?${params.join('&')}`);
  }
}
