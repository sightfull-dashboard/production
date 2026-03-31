-- Internal access model + support ticket discussion/resolution
-- Safe to run on Supabase PostgreSQL.

-- 1) Users: internal staff permissions / assigned clients / status
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_clients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 2) Users: MFA support for admin-controlled Google 2FA
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret text,
  ADD COLUMN IF NOT EXISTS mfa_backup_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Normalize legacy nulls if any
UPDATE public.users SET permissions = '[]'::jsonb WHERE permissions IS NULL;
UPDATE public.users SET assigned_clients = '[]'::jsonb WHERE assigned_clients IS NULL;
UPDATE public.users SET status = 'active' WHERE status IS NULL OR trim(status) = '';
UPDATE public.users SET mfa_backup_codes = '[]'::jsonb WHERE mfa_backup_codes IS NULL;

-- 3) Support tickets: resolution tracking
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS resolved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id text,
  ADD COLUMN IF NOT EXISTS resolved_by_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'support_tickets_resolved_by_user_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'support_tickets'
  ) THEN
    ALTER TABLE public.support_tickets
      ADD CONSTRAINT support_tickets_resolved_by_user_id_fkey
      FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id);
  END IF;
END $$;

-- 4) Internal discussion comments on support tickets
CREATE TABLE IF NOT EXISTS public.support_ticket_comments (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  user_email text NOT NULL,
  user_image text,
  role text NOT NULL,
  message text NOT NULL,
  tagged_users jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_users_role_client_id ON public.users(role, client_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_client_id_status ON public.support_tickets(client_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at ON public.support_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket_id_created_at ON public.support_ticket_comments(ticket_id, created_at ASC);

-- 6) Optional JSONB GIN indexes for larger data sets
CREATE INDEX IF NOT EXISTS idx_users_permissions_gin ON public.users USING GIN (permissions);
CREATE INDEX IF NOT EXISTS idx_users_assigned_clients_gin ON public.users USING GIN (assigned_clients);
CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_tagged_users_gin ON public.support_ticket_comments USING GIN (tagged_users);
