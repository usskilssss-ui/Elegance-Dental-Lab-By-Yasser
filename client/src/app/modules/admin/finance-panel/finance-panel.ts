import { Component, Input, OnChanges, OnInit, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinanceApiService, ProfitMode } from '../../../core/services/finance-api.service';

type FinanceInnerTab = 'overview' | 'inventory' | 'payroll' | 'expenses';

@Component({
  selector: 'app-finance-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './finance-panel.html',
  styleUrl: './finance-panel.css',
})
export class FinancePanel implements OnInit, OnChanges {
  private readonly api = inject(FinanceApiService);

  @Input() year: string | number = new Date().getFullYear();
  @Input() month: string | number = new Date().getMonth() + 1;

  innerTab: FinanceInnerTab = 'overview';
  profitMode: ProfitMode = 'cash';
  loading = false;
  error = '';
  okMsg = '';

  summary: any = null;
  stock: any[] = [];
  purchases: any[] = [];
  movements: any[] = [];
  employees: any[] = [];
  payrollRows: any[] = [];
  expenses: any[] = [];
  categoryLabels: Record<string, string> = {};

  purchaseForm = {
    materialId: '',
    quantity: 1,
    unitCost: 0,
    supplier: '',
    invoiceRef: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    notes: '',
  };

  adjustForm = {
    materialId: '',
    quantityDelta: 0,
    unitCost: 0,
    notes: '',
  };

  expenseForm = {
    category: 'other',
    title: '',
    amount: 0,
    expenseDate: new Date().toISOString().slice(0, 10),
    notes: '',
  };

  payrollEdit: Record<string, any> = {};

  ngOnInit(): void {
    this.reload();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['year'] || changes['month']) {
      this.reload();
    }
  }

  setInnerTab(tab: FinanceInnerTab) {
    this.innerTab = tab;
    this.error = '';
    this.okMsg = '';
    this.reload();
  }

  setProfitMode(mode: ProfitMode) {
    this.profitMode = mode;
    this.loadSummary();
  }

  reload() {
    if (this.innerTab === 'overview') this.loadSummary();
    if (this.innerTab === 'inventory') this.loadInventory();
    if (this.innerTab === 'payroll') this.loadPayroll();
    if (this.innerTab === 'expenses') this.loadExpenses();
  }

  private y() {
    return Number(this.year) || new Date().getFullYear();
  }
  private m() {
    return Number(this.month) || new Date().getMonth() + 1;
  }

  loadSummary() {
    this.loading = true;
    this.error = '';
    this.api.getSummary(this.y(), this.m(), this.profitMode).subscribe({
      next: (res) => {
        this.summary = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'فشل تحميل الملخص المالي';
        this.loading = false;
      },
    });
  }

  loadInventory() {
    this.loading = true;
    this.error = '';
    this.api.listStock().subscribe({
      next: (res) => {
        this.stock = res.materials || [];
        if (!this.purchaseForm.materialId && this.stock.length) {
          this.purchaseForm.materialId = this.stock[0]._id;
        }
        if (!this.adjustForm.materialId && this.stock.length) {
          this.adjustForm.materialId = this.stock[0]._id;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'فشل تحميل المخزون';
      },
    });
    this.api.listPurchases(this.y(), this.m()).subscribe({
      next: (res) => {
        this.purchases = res.purchases || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'فشل تحميل المشتريات';
        this.loading = false;
      },
    });
    this.api.listMovements(this.y(), this.m()).subscribe({
      next: (res) => (this.movements = res.movements || []),
      error: () => (this.movements = []),
    });
  }

  submitPurchase() {
    this.error = '';
    this.okMsg = '';
    this.api.createPurchase({ ...this.purchaseForm }).subscribe({
      next: () => {
        this.okMsg = 'تم تسجيل الشراء وتحديث المخزون';
        this.purchaseForm.quantity = 1;
        this.purchaseForm.unitCost = 0;
        this.purchaseForm.notes = '';
        this.loadInventory();
      },
      error: (err) => (this.error = err?.error?.message || 'فشل تسجيل الشراء'),
    });
  }

  submitAdjust() {
    this.error = '';
    this.okMsg = '';
    this.api.adjustStock({ ...this.adjustForm }).subscribe({
      next: () => {
        this.okMsg = 'تم تعديل المخزون';
        this.adjustForm.quantityDelta = 0;
        this.loadInventory();
      },
      error: (err) => (this.error = err?.error?.message || 'فشل تعديل المخزون'),
    });
  }

  saveLowStock(m: any) {
    this.api.updateStockSettings(m._id, { lowStockAlert: Number(m.lowStockAlert) || 0 }).subscribe({
      next: () => (this.okMsg = 'تم حفظ حد التنبيه'),
      error: (err) => (this.error = err?.error?.message || 'فشل الحفظ'),
    });
  }

  loadPayroll() {
    this.loading = true;
    this.error = '';
    this.api.listPayrollEmployees().subscribe({
      next: (res) => (this.employees = res.employees || []),
      error: (err) => (this.error = err?.error?.message || 'فشل تحميل الموظفين'),
    });
    this.api.listPayroll(this.y(), this.m()).subscribe({
      next: (res) => {
        this.payrollRows = res.rows || [];
        this.payrollEdit = {};
        for (const r of this.payrollRows) {
          this.payrollEdit[r._id] = {
            baseAmount: r.baseAmount,
            incentiveAmount: r.incentiveAmount,
            pieceUnits: r.pieceUnits,
            pieceRate: r.pieceRate,
            deductions: r.deductions,
            notes: r.notes || '',
            status: r.status,
          };
        }
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'فشل تحميل الرواتب';
        this.loading = false;
      },
    });
  }

  saveEmployeePay(emp: any) {
    this.api
      .updateEmployeePayroll(emp._id, {
        payrollEnabled: !!emp.payrollEnabled,
        baseSalary: Number(emp.baseSalary) || 0,
        defaultPieceRate: Number(emp.defaultPieceRate) || 0,
        payType: emp.payType || 'fixed',
      })
      .subscribe({
        next: () => (this.okMsg = `تم حفظ إعدادات ${emp.fullName}`),
        error: (err) => (this.error = err?.error?.message || 'فشل الحفظ'),
      });
  }

  generateDrafts() {
    this.api.generatePayroll(this.y(), this.m()).subscribe({
      next: (res) => {
        this.okMsg = `تم إنشاء ${res.createdCount || 0} مسودة راتب`;
        this.loadPayroll();
      },
      error: (err) => (this.error = err?.error?.message || 'فشل إنشاء المسودات'),
    });
  }

  savePayrollRow(row: any) {
    const edit = this.payrollEdit[row._id] || {};
    this.api
      .upsertPayroll({
        employeeId: row.employee,
        year: this.y(),
        month: this.m(),
        ...edit,
      })
      .subscribe({
        next: () => {
          this.okMsg = `تم حفظ راتب ${row.employeeName}`;
          this.loadPayroll();
        },
        error: (err) => (this.error = err?.error?.message || 'فشل حفظ الراتب'),
      });
  }

  markPaid(row: any) {
    const edit = { ...(this.payrollEdit[row._id] || {}), status: 'paid' };
    this.payrollEdit[row._id] = edit;
    this.savePayrollRow(row);
  }

  deletePayrollRow(row: any) {
    if (!confirm(`حذف راتب ${row.employeeName}؟`)) return;
    this.api.deletePayroll(row._id).subscribe({
      next: () => this.loadPayroll(),
      error: (err) => (this.error = err?.error?.message || 'فشل الحذف'),
    });
  }

  loadExpenses() {
    this.loading = true;
    this.api.listExpenses(this.y(), this.m()).subscribe({
      next: (res) => {
        this.expenses = res.expenses || [];
        this.categoryLabels = res.categoryLabels || {};
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'فشل تحميل المصاريف';
        this.loading = false;
      },
    });
  }

  submitExpense() {
    this.api.createExpense({ ...this.expenseForm }).subscribe({
      next: () => {
        this.okMsg = 'تم تسجيل المصروف';
        this.expenseForm.title = '';
        this.expenseForm.amount = 0;
        this.expenseForm.notes = '';
        this.loadExpenses();
      },
      error: (err) => (this.error = err?.error?.message || 'فشل تسجيل المصروف'),
    });
  }

  deleteExpense(e: any) {
    if (!confirm('حذف هذا المصروف؟')) return;
    this.api.deleteExpense(e._id).subscribe({
      next: () => this.loadExpenses(),
      error: (err) => (this.error = err?.error?.message || 'فشل الحذف'),
    });
  }

  stockValue(m: any) {
    return (Number(m.stockQty) || 0) * (Number(m.avgUnitCost) || 0);
  }

  payTypeLabel(t: string) {
    if (t === 'piece') return 'بالقطعة';
    if (t === 'mixed') return 'ثابت + قطعة';
    return 'ثابت شهري';
  }

  movementTypeLabel(t: string) {
    if (t === 'purchase') return 'شراء';
    if (t === 'consume') return 'استهلاك';
    return 'تعديل';
  }
}
