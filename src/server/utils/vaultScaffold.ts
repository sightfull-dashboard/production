import { supabaseAdmin } from '../integrations/supabase';

const randomId = () => Math.random().toString(36).slice(2, 11);

const findFolder = async ({
  clientId,
  name,
  parentId = null,
  employeeId = null,
}: {
  clientId: string;
  name: string;
  parentId?: string | null;
  employeeId?: string | null;
}) => {
  let query = supabaseAdmin
    .from('files')
    .select('id')
    .eq('client_id', clientId)
    .eq('type', 'folder')
    .eq('name', name);

  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  query = employeeId ? query.eq('employee_id', employeeId) : query.is('employee_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id ? String(data.id) : null;
};

const ensureFolder = async ({
  clientId,
  name,
  parentId = null,
  employeeId = null,
}: {
  clientId: string;
  name: string;
  parentId?: string | null;
  employeeId?: string | null;
}) => {
  const existingId = await findFolder({ clientId, name, parentId, employeeId });
  if (existingId) return existingId;
  const id = randomId();
  const { error } = await supabaseAdmin.from('files').insert({
    id,
    client_id: clientId,
    parent_id: parentId,
    employee_id: employeeId,
    name,
    type: 'folder',
    password: null,
    uploaded_by: null,
  });
  if (error) throw error;
  return id;
};

export const ensureClientVaultStructureSupabase = async (clientId: string | null | undefined) => {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return;

  const labourDocsId = await ensureFolder({ clientId: normalizedClientId, name: 'Labour & Docs' });
  const employeesRootId = await ensureFolder({ clientId: normalizedClientId, name: 'Employees' });

  for (const name of ['Tax Year 2020', 'Tax Year 2021', 'Tax Year 2022', 'Tax Year 2023', 'Tax Year 2024']) {
    await ensureFolder({ clientId: normalizedClientId, name });
  }
  const tax2025Id = await ensureFolder({ clientId: normalizedClientId, name: 'Tax Year 2025' });
  const tax2026Id = await ensureFolder({ clientId: normalizedClientId, name: 'Tax Year 2026' });

  const labourEmployeesFolderId = await ensureFolder({ clientId: normalizedClientId, name: 'Employees', parentId: labourDocsId });
  for (const name of ['Hearings Etc', 'Excel', 'Company Docs', 'COIDA']) {
    await ensureFolder({ clientId: normalizedClientId, name, parentId: labourDocsId });
  }
  await ensureFolder({ clientId: normalizedClientId, name: 'Employee Contracts', parentId: labourEmployeesFolderId });

  const { data: activeEmployees, error: employeesError } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, emp_id, status')
    .eq('client_id', normalizedClientId)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true });
  if (employeesError) throw employeesError;

  for (const employee of (activeEmployees || []).filter((row: any) => String(row.status || 'active').toLowerCase() !== 'offboarded')) {
    const displayName = [employee.first_name, employee.last_name]
      .map((part: any) => String(part || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim() || String(employee.emp_id || employee.id || 'Employee').trim();

    const { data: existingFolder, error: existingError } = await supabaseAdmin
      .from('files')
      .select('id, parent_id')
      .eq('client_id', normalizedClientId)
      .eq('type', 'folder')
      .eq('employee_id', employee.id)
      .order('name', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existingFolder?.id) {
      const { error: updateError } = await supabaseAdmin
        .from('files')
        .update({ name: displayName, parent_id: employeesRootId, client_id: normalizedClientId })
        .eq('id', existingFolder.id);
      if (updateError) throw updateError;
      continue;
    }

    await ensureFolder({ clientId: normalizedClientId, name: displayName, parentId: employeesRootId, employeeId: employee.id });
  }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const ensureTaxYearStructure = async (taxFolderId: string | null) => {
    if (!taxFolderId) return;
    const weeklyId = await ensureFolder({ clientId: normalizedClientId, name: 'Weekly Payroll', parentId: taxFolderId });
    await ensureFolder({ clientId: normalizedClientId, name: 'Monthly Payroll', parentId: taxFolderId });
    const proofsId = await ensureFolder({ clientId: normalizedClientId, name: 'Proofs', parentId: taxFolderId });
    for (const monthName of months) {
      await ensureFolder({ clientId: normalizedClientId, name: monthName, parentId: weeklyId });
    }
    await ensureFolder({ clientId: normalizedClientId, name: 'SARS', parentId: proofsId });
    await ensureFolder({ clientId: normalizedClientId, name: 'Mibco', parentId: proofsId });
  };

  await ensureTaxYearStructure(tax2025Id);
  await ensureTaxYearStructure(tax2026Id);
  const nextYearLabel = `Tax Year ${new Date().getFullYear() + 1}`;
  const nextTaxYearId = await ensureFolder({ clientId: normalizedClientId, name: nextYearLabel });
  await ensureTaxYearStructure(nextTaxYearId);
};
