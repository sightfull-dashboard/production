import { createRequestSupabaseClient, supabaseAdmin } from "../integrations/supabase";

const parseJsonArray = (value: any) => Array.isArray(value) ? value : (() => {
  try { return value ? JSON.parse(value) : []; } catch { return []; }
})();

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const buildAppMetadata = (user: any) => ({
  app_role: String(user?.role || '').toLowerCase() || 'staff',
  client_id: user?.client_id ?? null,
  assigned_clients: parseJsonArray(user?.assigned_clients).map((item: any) => String(item)).filter(Boolean),
});

export async function signInWithSupabasePassword(email: string, password: string) {
  const client = createRequestSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { session: null, user: null, error };
  return { session: data.session || null, user: data.user || null, error: null };
}

export async function findSupabaseAuthUserByEmail(email: string) {
  if (!supabaseAdmin) return null;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((row) => normalizeEmail(row.email) === normalizedEmail) || null;
    if (match) return match;
    if (users.length < 200) break;
    page += 1;
  }

  return null;
}

export async function linkAppUserToAuthUser(appUserId: string, authUserId: string) {
  if (!supabaseAdmin || !appUserId || !authUserId) return;
  const { error } = await supabaseAdmin
    .from('users')
    .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
    .eq('id', appUserId);
  if (error) throw error;
}

export async function syncSupabaseAuthUser(appUser: any, options: { password?: string; email?: string; name?: string | null; emailConfirm?: boolean } = {}) {
  if (!supabaseAdmin) return { authUserId: appUser?.auth_user_id || null, created: false };

  const email = normalizeEmail(options.email ?? appUser?.email);
  if (!email) throw new Error('Email is required to sync a Supabase Auth user.');

  let authUserId = appUser?.auth_user_id ? String(appUser.auth_user_id) : '';
  let created = false;

  if (!authUserId) {
    const existing = await findSupabaseAuthUserByEmail(email);
    if (existing?.id) authUserId = existing.id;
  }

  const payload: any = {
    email,
    email_confirm: options.emailConfirm ?? true,
    user_metadata: {
      name: options.name ?? appUser?.name ?? null,
    },
    app_metadata: buildAppMetadata({ ...appUser, email }),
  };

  if (options.password) payload.password = options.password;

  if (authUserId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, payload);
    if (error) throw error;
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser(payload);
    if (error) throw error;
    authUserId = data.user?.id || '';
    created = true;
  }

  if (authUserId && appUser?.id && authUserId !== appUser?.auth_user_id) {
    await linkAppUserToAuthUser(String(appUser.id), authUserId);
  }

  return { authUserId: authUserId || null, created };
}

export async function deleteSupabaseAuthUser(authUserId: string | null | undefined) {
  if (!supabaseAdmin || !authUserId) return;
  const { error } = await supabaseAdmin.auth.admin.deleteUser(String(authUserId));
  if (error) throw error;
}
