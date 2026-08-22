import { Routes } from '@angular/router';
import { AppRole } from './core/auth/auth.types';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { Login } from './modules/login/login';
import { Secretary } from './modules/secretary/secretary';
import { Admin } from './modules/admin/admin';
import { CaseManagementComponent } from './modules/case-management/case-management';
import { SecretaryDashboardComponent } from './modules/secretary-dashboard/secretary-dashboard';
import { Finishing } from './modules/finishing/finishing';
import { RequesterComponent } from './modules/requester/requester';
import { EntryComponent } from './modules/entry/entry';
import { DoctorComponent } from './modules/doctor/doctor';
import { DoctorAccountsComponent } from './modules/doctor/doctor-accounts';
import { DoctorRequestRepComponent } from './modules/doctor/doctor-request-rep';
import { DoctorExitedMaterialsComponent } from './modules/doctor/doctor-exited-materials';
import { StationScanComponent } from './modules/station-scan/station-scan';
import { ForDoctorsComponent } from './modules/for-doctors/for-doctors';

/** Admin may open designer / secretary / finisher workspaces from the admin UI. */
const WITH_ADMIN: (r: AppRole) => AppRole[] = r => [r, 'admin'];

export const routes: Routes = [
  { path: 'login', component: Login, canActivate: [guestGuard] },
  { path: 'for-doctors', component: ForDoctorsComponent },
  { path: 'doctors', pathMatch: 'full', redirectTo: 'for-doctors' },

  {
    path: 'scan',
    component: StationScanComponent,
    canActivate: [
      authGuard,
      roleGuard(['admin', 'secretary', 'designer', 'finisher', 'scanner1', 'scanner2', 'scanner3']),
    ],
  },
  { path: 'scan/:station', pathMatch: 'full', redirectTo: '/scan' },

  {
    path: 'admin',
    canActivate: [authGuard, roleGuard(['admin'])],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: Admin },
      { path: 'case-management', component: CaseManagementComponent },
    ],
  },

  {
    path: 'secretary',
    canActivate: [authGuard, roleGuard(WITH_ADMIN('secretary'))],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: Secretary },
      { path: 'stats', component: SecretaryDashboardComponent },
    ],
  },

  {
    path: 'designer',
    canActivate: [authGuard, roleGuard(WITH_ADMIN('designer'))],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () => import('./modules/design/design.routes').then(m => m.routes),
      },
    ],
  },

  {
    path: 'entry',
    canActivate: [authGuard, roleGuard(['finisher', 'secretary', 'admin'])],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: EntryComponent },
    ],
  },

  {
    path: 'finisher',
    canActivate: [authGuard, roleGuard(['finisher', 'secretary', 'admin'])],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: EntryComponent },
    ],
  },

  {
    path: 'doctor',
    canActivate: [authGuard, roleGuard(WITH_ADMIN('doctor'))],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DoctorComponent },
      { path: 'accounts', component: DoctorAccountsComponent },
      { path: 'request-rep', component: DoctorRequestRepComponent },
      { path: 'exited-materials', component: DoctorExitedMaterialsComponent },
    ],
  },

  {
    path: 'requester',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: RequesterComponent },
    ],
  },

  /* Legacy URLs → canonical RBAC paths */
  { path: 'secretary-dashboard', pathMatch: 'full', redirectTo: '/secretary/stats' },
  { path: 'finishing', pathMatch: 'full', redirectTo: '/entry/dashboard' },
  { path: 'design', pathMatch: 'full', redirectTo: '/designer/dashboard' },

  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: '/login' },
];
