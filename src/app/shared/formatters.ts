export const toTitleCase = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

export const formatAccountDisplayName = (user?: { name?: string | null; email?: string | null }) => {
  return toTitleCase(user?.name || user?.email?.split('@')[0] || 'User') || 'User';
};

export const formatRoleLabel = (role?: string | null) => {
  return toTitleCase(role || 'user') || 'User';
};

export const getSidebarBrandLabel = (opts?: { clientName?: string | null; client_name?: string | null; isSuperAdmin?: boolean }) => {
  const clientName = String(opts?.clientName || opts?.client_name || '').trim();
  if (clientName) return clientName;
  return opts?.isSuperAdmin ? 'Sightfull Pro v2.0' : 'Client';
};

export const employeeIdNumericValue = (value?: string | null) => {
  const match = String(value || '').trim().toUpperCase().match(/^EMP(\d+)$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

export const compareEmployeeIds = (left?: string | null, right?: string | null) => {
  const leftNum = employeeIdNumericValue(left);
  const rightNum = employeeIdNumericValue(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
};

export const generateAutoEmployeeId = (existingEmployees: Array<{ emp_id?: string | null }>) => {
  const nextSequence = existingEmployees.reduce((maxValue, employee) => {
    const numericValue = employeeIdNumericValue(employee.emp_id);
    return Number.isFinite(numericValue) ? Math.max(maxValue, numericValue) : maxValue;
  }, 0) + 1;
  return `EMP${String(nextSequence).padStart(3, '0')}`;
};

export const digitsOnly = (value?: string | number | null) => String(value ?? '').replace(/\D/g, '');

export const formatHourlyRateInput = (value?: string | number | null) => {
  const digits = digitsOnly(value).padStart(8, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const decimals = digits.slice(-4);
  return `R${whole.padStart(3, '0')}.${decimals}`;
};

export const parseHourlyRateInputToNumber = (value?: string | null) => {
  const digits = digitsOnly(value).padStart(8, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const decimals = digits.slice(-4);
  return Number(`${whole}.${decimals}`);
};

export const formatStoredHourlyRate = (value?: string | number | null) => {
  const normalized = String(value ?? '').replace(/[^0-9.-]/g, '').trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 'R000.0000';
  const [wholePart, decimalPart = '0000'] = parsed.toFixed(4).split('.');
  return `R${wholePart.padStart(3, '0')}.${decimalPart}`;
};

export const formatLeaveInput = (value?: string | number | null) => {
  const digits = digitsOnly(value).padStart(6, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const decimals = digits.slice(-4);
  return `${whole.padStart(2, '0')}.${decimals}`;
};

export const parseLeaveInputToNumber = (value?: string | null) => {
  const digits = digitsOnly(value).padStart(6, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const decimals = digits.slice(-4);
  return Number(`${whole}.${decimals}`);
};

export const phoneDigitsToLocalSa = (value?: string | null) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('27')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
};

export const normalizeSouthAfricanCell = (value?: string | null) => {
  const localDigits = phoneDigitsToLocalSa(value);
  return localDigits ? `+27${localDigits}` : '';
};
