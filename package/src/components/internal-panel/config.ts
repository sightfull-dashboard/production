import type { RosterDefinition } from '../../types';

export const INTERNAL_PANEL_ROSTER_DEFINITIONS: { id: RosterDefinition; label: string }[] = [
  { id: 'shortages', label: 'Shortages' },
  { id: 'uniform', label: 'Uniform' },
  { id: 'salary_advance', label: 'Salary Advance' },
  { id: 'staff_loan', label: 'Staff Loan' },
  { id: 'overthrows', label: 'Overthrows' },
  { id: 'oil_spill', label: 'Oil Spill' },
  { id: 'stock_shortage', label: 'Stock Shortage' },
  { id: 'unpaid_hours', label: 'Unpaid Hours' },
  { id: 'annual_bonus', label: 'Annual Bonus' },
  { id: 'incentive_bonus', label: 'Incentive Bonus' },
  { id: 'data_allowance', label: 'Data Allowance' },
  { id: 'night_shift_allowance', label: 'Night Shift Allowance' },
  { id: 'medical_allowance', label: 'Medical Allowance' },
  { id: 'mibco_health_insurance', label: 'Mibco Health Insurance' },
  { id: 'health_insurance', label: 'Health Insurance' },
  { id: 'garnishee', label: 'Garnishee' },
  { id: 'cell_phone_payment', label: 'Cell Phone Payment' },
  { id: 'income_tax_registration', label: 'Income Tax Registration' },
  { id: 'performance_incentive', label: 'Performance Incentive' },
  { id: 'commission', label: 'Commission' },
  { id: 'sales_commission', label: 'Sales Commission' },
  { id: 'notes', label: 'Notes' },
];

export const PRESET_CLIENT_LOGOS = [
  { id: 'puma', label: 'Puma Energy', src: '/client-logo-puma.png' },
  { id: 'sasol', label: 'Sasol', src: '/client-logo-sasol.png' },
  { id: 'green', label: 'Green', src: '/client-logo-green.png' },
  { id: 'total', label: 'TotalEnergies', src: '/client-logo-total.png' },
  { id: 'shell', label: 'Shell', src: '/client-logo-shell.png' },
  { id: 'engen', label: 'Engen', src: '/client-logo-engen.png' },
  { id: 'bp', label: 'BP', src: '/client-logo-bp.png' },
  { id: 'astron', label: 'Astron Energy', src: '/client-logo-astron.png' },
] as const;
