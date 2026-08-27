const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const financeController = require('../controllers/financeController');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

router.get('/summary', ...adminOnly, financeController.getFinanceSummary);

router.get('/stock', ...adminOnly, financeController.listStock);
router.post('/stock/adjust', ...adminOnly, financeController.adjustStock);
router.patch('/stock/:id/settings', ...adminOnly, financeController.updateMaterialStockSettings);
router.get('/purchases', ...adminOnly, financeController.listPurchases);
router.post('/purchases', ...adminOnly, financeController.createPurchase);
router.get('/movements', ...adminOnly, financeController.listMovements);

router.get('/payroll/employees', ...adminOnly, financeController.listPayrollEmployees);
router.post('/payroll/employees', ...adminOnly, financeController.createPayrollEmployee);
router.patch('/payroll/employees/:id', ...adminOnly, financeController.updateEmployeePayroll);
router.delete('/payroll/employees/:id', ...adminOnly, financeController.deletePayrollEmployee);
router.get('/payroll', ...adminOnly, financeController.listPayroll);
router.post('/payroll', ...adminOnly, financeController.upsertPayroll);
router.post('/payroll/generate', ...adminOnly, financeController.generatePayrollDrafts);
router.delete('/payroll/:id', ...adminOnly, financeController.deletePayroll);

router.get('/expenses', ...adminOnly, financeController.listExpenses);
router.post('/expenses', ...adminOnly, financeController.createExpense);
router.delete('/expenses/:id', ...adminOnly, financeController.deleteExpense);

router.get('/alerts/stock', ...adminOnly, financeController.getStockAlerts);
router.get('/doctor-debts', ...adminOnly, financeController.getDoctorDebts);
router.post('/doctor-debts/remind', ...adminOnly, financeController.remindDoctorDebt);
router.get('/case-profits', ...adminOnly, financeController.getCaseProfitability);

module.exports = router;
