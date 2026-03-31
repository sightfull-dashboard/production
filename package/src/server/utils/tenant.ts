import type { Request } from 'express';

const normalizeClientId = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

const clientExists = (db: any, clientId: string) => {
  try {
    const row = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId) as { id?: string } | undefined;
    return Boolean(row?.id);
  } catch {
    return false;
  }
};

export const getSessionRole = (req: Request) => {
  return String((req.session as any)?.userRole || (req.session as any)?.role || '').toLowerCase();
};

export const getRequestedActiveClientId = (req: Request) => {
  const headerValue = Array.isArray(req.headers['x-active-client-id'])
    ? req.headers['x-active-client-id'][0]
    : req.headers['x-active-client-id'];
  return normalizeClientId(headerValue);
};

export const getActorClientId = (db: any, req: Request) => {
  const sessionUserId = normalizeClientId((req.session as any)?.userId);
  const sessionUserClientId = normalizeClientId((req.session as any)?.userClientId);
  if (sessionUserClientId) return sessionUserClientId;
  if (sessionUserId && db && typeof db.prepare === 'function') {
    const user = db.prepare('SELECT client_id FROM users WHERE id = ?').get(sessionUserId) as any;
    const userClientId = normalizeClientId(user?.client_id);
    if (userClientId) return userClientId;
  }

  const employeeClientId = normalizeClientId((req.session as any)?.employeeClientId);
  if (employeeClientId) {
    return employeeClientId;
  }

  const sessionEmployeeId = normalizeClientId((req.session as any)?.employeeId);
  if (sessionEmployeeId && db && typeof db.prepare === 'function') {
    const employee = db.prepare('SELECT client_id FROM employees WHERE id = ?').get(sessionEmployeeId) as any;
    const resolvedClientId = normalizeClientId(employee?.client_id);
    if (resolvedClientId) return resolvedClientId;
  }

  return null;
};

export const getEffectiveClientId = (db: any, req: Request) => {
  const sessionRole = getSessionRole(req);
  const requestedClientId = getRequestedActiveClientId(req);

  if (sessionRole === 'superadmin') {
    if (!requestedClientId) return null;
    return db && typeof db.prepare === 'function' ? (clientExists(db, requestedClientId) ? requestedClientId : null) : requestedClientId;
  }

  return getActorClientId(db, req);
};

export const getTenantResolution = (db: any, req: Request) => {
  const sessionRole = getSessionRole(req);
  const requestedClientId = getRequestedActiveClientId(req);
  const actorClientId = getActorClientId(db, req);
  const effectiveClientId = getEffectiveClientId(db, req);

  return {
    sessionRole,
    requestedClientId,
    actorClientId,
    effectiveClientId,
    hasValidSuperAdminScope: sessionRole === 'superadmin' ? Boolean(effectiveClientId) : true,
  };
};
