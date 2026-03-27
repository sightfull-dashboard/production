export const SUPERADMIN_ROLE = "superadmin" as const;

export type AppRole = "admin" | "user" | typeof SUPERADMIN_ROLE;

export const normalizeUserRole = (role?: string | null): AppRole | null => {
  if (!role) return null;
  if (role === 'super_admin') return SUPERADMIN_ROLE;
  if (role === SUPERADMIN_ROLE || role === 'admin' || role === 'user') return role;
  return null;
};

export const isSuperAdminRole = (role?: string | null): boolean => normalizeUserRole(role) === SUPERADMIN_ROLE;

export const isSuperAdminPath = (pathname: string): boolean => pathname.startsWith('/admin');
export const isEmployeePath = (pathname: string): boolean => pathname.startsWith('/employee');
