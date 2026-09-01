import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ProfitMode = 'cash' | 'accrual';

@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/finance`;

  private params(year?: number | string, month?: number | string, extra?: Record<string, string>) {
    let p = new HttpParams();
    if (year) p = p.set('year', String(year));
    if (month) p = p.set('month', String(month));
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
      }
    }
    return p;
  }

  getSummary(year: number | string, month: number | string, mode: ProfitMode): Observable<any> {
    return this.http.get(`${this.base}/summary`, {
      params: this.params(year, month, { mode }),
    });
  }

  listStock(): Observable<any> {
    return this.http.get(`${this.base}/stock`);
  }

  listPurchases(year: number | string, month: number | string): Observable<any> {
    return this.http.get(`${this.base}/purchases`, { params: this.params(year, month) });
  }

  createPurchase(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/purchases`, body);
  }

  adjustStock(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/stock/adjust`, body);
  }

  updateStockSettings(id: string, body: { lowStockAlert: number }): Observable<any> {
    return this.http.patch(`${this.base}/stock/${id}/settings`, body);
  }

  listMovements(year: number | string, month: number | string): Observable<any> {
    return this.http.get(`${this.base}/movements`, { params: this.params(year, month) });
  }

  listPayrollEmployees(): Observable<any> {
    return this.http.get(`${this.base}/payroll/employees`);
  }

  createPayrollEmployee(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/payroll/employees`, body);
  }

  updateEmployeePayroll(id: string, body: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.base}/payroll/employees/${id}`, body);
  }

  deletePayrollEmployee(id: string): Observable<any> {
    return this.http.delete(`${this.base}/payroll/employees/${id}`);
  }

  listPayroll(year: number | string, month: number | string): Observable<any> {
    return this.http.get(`${this.base}/payroll`, { params: this.params(year, month) });
  }

  upsertPayroll(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/payroll`, body);
  }

  generatePayroll(year: number | string, month: number | string): Observable<any> {
    return this.http.post(`${this.base}/payroll/generate`, { year: Number(year), month: Number(month) });
  }

  deletePayroll(id: string): Observable<any> {
    return this.http.delete(`${this.base}/payroll/${id}`);
  }

  listExpenses(year: number | string, month: number | string): Observable<any> {
    return this.http.get(`${this.base}/expenses`, { params: this.params(year, month) });
  }

  createExpense(body: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.base}/expenses`, body);
  }

  deleteExpense(id: string): Observable<any> {
    return this.http.delete(`${this.base}/expenses/${id}`);
  }

  getStockAlerts(): Observable<any> {
    return this.http.get(`${this.base}/alerts/stock`);
  }

  getDoctorDebts(): Observable<any> {
    return this.http.get(`${this.base}/doctor-debts`);
  }

  remindDoctorDebt(body: { doctorName: string; phone?: string }): Observable<any> {
    return this.http.post(`${this.base}/doctor-debts/remind`, body);
  }

  getCaseProfits(year: number | string, month: number | string): Observable<any> {
    return this.http.get(`${this.base}/case-profits`, { params: this.params(year, month) });
  }
}
