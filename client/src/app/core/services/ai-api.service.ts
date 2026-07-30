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

  askAssistant(question: string): Observable<any> {
    const query = `?question=${encodeURIComponent(question)}`;
    return this.http.get(`${this.apiUrl}/assistant${query}`);
  }
}
