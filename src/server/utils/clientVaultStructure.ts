import { supabaseAdmin } from '../integrations/supabase';

const randomId = () => Math.random().toString(36).slice(2, 11);
const nowIso = () => new Date().toISOString();

const normalizeKey = ({ name, parentId, employeeId }: { name: string; parentId?: string | null; employeeId?: string | null }) => {
  return `${String(employeeId || 'client')}::${String(parentId || 'root')}::${String(name || '').trim().toLowerCase()}`;
};

const buildEmployeeDisplayName = (employee: any) => {
  const first = String(employee?.first_name || '').trim();
  const last = String(employee?.last_name || '').trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return combined || String(employee?.emp_id || employee?.id || 'Employee').trim();
};

const upsertFolderIdentity = async (folderId: string, updates: Record<string, any>) => {
  const payload = { ...updates, updated_at: nowIso() };
  const { error } = await supabaseAdmin.from('files').update(payload).eq('id', folderId);
  if (error) throw error;
};

export const ensureSupabaseClientVaultStructure = async (clientId: string | null | undefined) => {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return;

  const { data: employeesData, error: employeesError } = await supabaseAdmin
    .from('employees')
    .select('id,emp_id,first_name,last_name,status,client_id')
    .eq('client_id', normalizedClientId)
    .neq('status', 'offboarded');

  if (employeesError) throw employeesError;
  const employees = (employeesData || []) as any[];
  const employeeIds = employees.map((employee) => String(employee.id || '').trim()).filter(Boolean);

  if (employeeIds.length) {
    const { error: normalizeEmployeeFilesError } = await supabaseAdmin
      .from('files')
      .update({ client_id: normalizedClientId, updated_at: nowIso() })
      .in('employee_id', employeeIds);
    if (normalizeEmployeeFilesError) throw normalizeEmployeeFilesError;
  }

  const { data: folderRows, error: folderRowsError } = await supabaseAdmin
    .from('files')
    .select('id,name,parent_id,employee_id,client_id,type')
    .eq('client_id', normalizedClientId)
    .eq('type', 'folder');

  if (folderRowsError) throw folderRowsError;

  const folders = (folderRows || []) as any[];
  const folderKeyToId = new Map<string, string>();
  const employeeFoldersById = new Map<string, any[]>();

  for (const folder of folders) {
    const folderId = String(folder.id || '').trim();
    if (!folderId) continue;
    folderKeyToId.set(normalizeKey({ name: folder.name, parentId: folder.parent_id, employeeId: folder.employee_id }), folderId);
    if (folder.employee_id) {
      const employeeId = String(folder.employee_id || '').trim();
      if (!employeeId) continue;
      const current = employeeFoldersById.get(employeeId) || [];
      current.push(folder);
      employeeFoldersById.set(employeeId, current);
    }
  }

  const insertFolder = async ({ name, parentId = null, employeeId = null }: { name: string; parentId?: string | null; employeeId?: string | null }) => {
    const key = normalizeKey({ name, parentId, employeeId });
    const existingId = folderKeyToId.get(key);
    if (existingId) return existingId;

    const payload = {
      id: randomId(),
      client_id: normalizedClientId,
      parent_id: parentId,
      employee_id: employeeId,
      name,
      type: 'folder',
      mime_type: null,
      size_bytes: null,
      storage_bucket: null,
      storage_path: null,
      public_url: null,
      password: null,
      uploaded_by: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    const { data, error } = await supabaseAdmin.from('files').insert(payload).select('id').single();
    if (error) throw error;
    const id = String((data as any)?.id || payload.id);
    folderKeyToId.set(key, id);
    return id;
  };

  const labourDocsId = await insertFolder({ name: 'Labour & Docs' });
  const clientEmployeesId = await insertFolder({ name: 'Employees' });
  const labourEmployeesId = await insertFolder({ name: 'Employees', parentId: labourDocsId });
  await insertFolder({ name: 'Employee Contracts', parentId: labourEmployeesId });
  for (const name of ['Hearings Etc', 'Excel', 'Company Docs', 'COIDA']) {
    await insertFolder({ name, parentId: labourDocsId });
  }

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  const lastTaxYear = Math.max(2026, currentYear + 1);
  for (let year = 2020; year <= lastTaxYear; year += 1) {
    const taxYearId = await insertFolder({ name: `Tax Year ${year}` });
    const weeklyId = await insertFolder({ name: 'Weekly Payroll', parentId: taxYearId });
    await insertFolder({ name: 'Monthly Payroll', parentId: taxYearId });
    const proofsId = await insertFolder({ name: 'Proofs', parentId: taxYearId });
    await insertFolder({ name: 'SARS', parentId: proofsId });
    await insertFolder({ name: 'Mibco', parentId: proofsId });
    for (const monthName of months) {
      await insertFolder({ name: monthName, parentId: weeklyId });
    }
  }

  await insertFolder({ name: 'Templates', parentId: clientEmployeesId });

  for (const employee of employees) {
    const employeeId = String(employee.id || '').trim();
    if (!employeeId) continue;

    const displayName = buildEmployeeDisplayName(employee);
    const employeeFolders = employeeFoldersById.get(employeeId) || [];
    const rootCandidates = employeeFolders.filter((folder) => {
      const parentId = folder.parent_id ? String(folder.parent_id) : null;
      return !parentId || parentId === clientEmployeesId;
    });

    let rootFolder =
      rootCandidates.find((folder) => String(folder.parent_id || '') === clientEmployeesId) ||
      rootCandidates[0] ||
      null;

    if (rootFolder?.id) {
      const currentName = String(rootFolder.name || '').trim();
      const currentParentId = rootFolder.parent_id ? String(rootFolder.parent_id) : null;
      const currentClientId = String(rootFolder.client_id || '').trim() || null;
      const updates: Record<string, any> = {};

      if (currentName !== displayName) updates.name = displayName;
      if (currentParentId !== clientEmployeesId) updates.parent_id = clientEmployeesId;
      if (currentClientId !== normalizedClientId) updates.client_id = normalizedClientId;
      if (String(rootFolder.employee_id || '') !== employeeId) updates.employee_id = employeeId;

      if (Object.keys(updates).length) {
        await upsertFolderIdentity(String(rootFolder.id), updates);
      }

      folderKeyToId.delete(normalizeKey({ name: currentName, parentId: currentParentId, employeeId }));
      folderKeyToId.set(normalizeKey({ name: displayName, parentId: clientEmployeesId, employeeId }), String(rootFolder.id));
    } else {
      const rootId = await insertFolder({ name: displayName, parentId: clientEmployeesId, employeeId });
      rootFolder = { id: rootId, name: displayName, employee_id: employeeId, parent_id: clientEmployeesId, client_id: normalizedClientId };
    }

    const employeeRootId = String(rootFolder.id || '').trim();
    if (!employeeRootId) continue;

    for (const duplicate of rootCandidates) {
      const duplicateId = String(duplicate.id || '').trim();
      if (!duplicateId || duplicateId === employeeRootId) continue;

      const { error: reparentChildrenError } = await supabaseAdmin
        .from('files')
        .update({ parent_id: employeeRootId, client_id: normalizedClientId, employee_id: employeeId, updated_at: nowIso() })
        .eq('parent_id', duplicateId)
        .eq('client_id', normalizedClientId);
      if (reparentChildrenError) throw reparentChildrenError;

      const { error: deleteDuplicateError } = await supabaseAdmin
        .from('files')
        .delete()
        .eq('id', duplicateId)
        .eq('client_id', normalizedClientId);
      if (deleteDuplicateError) throw deleteDuplicateError;

      folderKeyToId.delete(normalizeKey({ name: duplicate.name, parentId: duplicate.parent_id, employeeId }));
    }

    for (const folderName of ['Contracts', 'ID & Passport', 'Tax Documents', 'Certificates', 'Other']) {
      await insertFolder({ name: folderName, parentId: employeeRootId, employeeId });
    }
  }
};
