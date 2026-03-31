create table if not exists public.background_jobs (
  id text primary key,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb,
  result jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_background_jobs_status_available on public.background_jobs(status, available_at, created_at);
create index if not exists idx_background_jobs_locked_at on public.background_jobs(locked_at);

create or replace function public.claim_background_job(
  p_worker_id text,
  p_allowed_types text[] default null
)
returns setof public.background_jobs
language sql
security definer
as $$
  with next_job as (
    select id
    from public.background_jobs
    where (
      (status = 'queued' and available_at <= now())
      or (status = 'running' and locked_at is not null and locked_at <= now() - interval '15 minutes')
    )
      and (p_allowed_types is null or job_type = any(p_allowed_types))
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.background_jobs j
  set status = 'running',
      attempts = coalesce(j.attempts, 0) + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      last_error = null,
      updated_at = now()
  from next_job
  where j.id = next_job.id
  returning j.*;
$$;
