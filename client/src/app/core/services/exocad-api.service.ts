import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Matches backend getCaseExocadView() */
export interface ExocadCaseStatus {
  caseId: string;
  caseNumber: string;
  exited: boolean;
  doctor: string;
  patient: string;
  requestedUnits: number;
  requestedTeeth: string[];
  actualDesignedUnits: number | null;
  actualDesignedTeeth: string[];
  unitsDifference: number | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string;
  exocadCaseId: string;
  exocadDoctorName: string;
  exocadPatientName: string;
  sourceFile: string;
  matchCandidateIds: string[];
}

export interface ExocadDoctorMapping {
  _id?: string;
  internalDoctorName: string;
  exocadNames: string[];
  active?: boolean;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class ExocadApiService {
  private base = `${environment.apiUrl}/exocad`;

  constructor(private http: HttpClient) {}

  getCaseStatus(caseId: string): Observable<{ success: boolean; data: ExocadCaseStatus }> {
    return this.http.get<{ success: boolean; data: ExocadCaseStatus }>(
      `${this.base}/cases/${caseId}`
    );
  }

  syncCase(caseId: string) {
    return this.http.post<{ success: boolean; data?: ExocadCaseStatus; message?: string }>(
      `${this.base}/cases/${caseId}/sync`,
      {}
    );
  }

  confirmMatch(caseId: string, exocadCaseId: string) {
    return this.http.post<{ success: boolean; data: ExocadCaseStatus }>(
      `${this.base}/cases/${caseId}/confirm`,
      { exocadCaseId }
    );
  }

  listDoctorMappings() {
    return this.http.get<{ success: boolean; data: ExocadDoctorMapping[] }>(
      `${this.base}/doctor-mappings`
    );
  }

  saveDoctorMapping(payload: {
    internalDoctorName: string;
    exocadNames: string[];
    active?: boolean;
    notes?: string;
  }) {
    return this.http.post<{ success: boolean; data: ExocadDoctorMapping }>(
      `${this.base}/doctor-mappings`,
      payload
    );
  }

  deleteDoctorMapping(id: string) {
    return this.http.delete<{ success: boolean }>(`${this.base}/doctor-mappings/${id}`);
  }
}
