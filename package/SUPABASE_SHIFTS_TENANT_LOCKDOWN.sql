-- Tenant-lock shifts for Supabase mode.
-- Run this in Supabase SQL Editor BEFORE using the patched app.
-- It adds shifts.client_id, backfills single-client usage, splits shared shifts by client,
-- repoints roster rows, and leaves only truly-unowned legacy shifts with client_id = NULL
-- for manual review.

BEGIN;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS client_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shifts_client_id_fkey'
      AND conrelid = 'public.shifts'::regclass
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES public.clients(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_client_id ON public.shifts(client_id);
CREATE INDEX IF NOT EXISTS idx_shifts_client_label ON public.shifts(client_id, label);

CREATE TEMP TABLE tmp_shift_client_usage AS
SELECT
  r.shift_id,
  e.client_id
FROM public.roster r
JOIN public.employees e ON e.id = r.employee_id
WHERE r.shift_id IS NOT NULL
  AND e.client_id IS NOT NULL
GROUP BY r.shift_id, e.client_id;

CREATE TEMP TABLE tmp_shift_usage_count AS
SELECT
  shift_id,
  COUNT(*)::int AS client_count
FROM tmp_shift_client_usage
GROUP BY shift_id;

-- Shifts used by exactly one client can be assigned in place.
UPDATE public.shifts s
SET client_id = u.client_id
FROM tmp_shift_client_usage u
JOIN tmp_shift_usage_count c ON c.shift_id = u.shift_id
WHERE s.id = u.shift_id
  AND c.client_count = 1
  AND (s.client_id IS NULL OR s.client_id <> u.client_id);

-- Shifts shared across multiple clients must be duplicated per client.
CREATE TEMP TABLE tmp_shared_shift_map AS
SELECT
  u.shift_id AS original_shift_id,
  u.client_id,
  (u.shift_id || '__' || u.client_id) AS new_shift_id
FROM tmp_shift_client_usage u
JOIN tmp_shift_usage_count c ON c.shift_id = u.shift_id
WHERE c.client_count > 1;

INSERT INTO public.shifts (
  id,
  label,
  start,
  "end",
  lunch,
  created_at,
  updated_at,
  client_id
)
SELECT
  m.new_shift_id,
  s.label,
  s.start,
  s."end",
  s.lunch,
  COALESCE(s.created_at, now()),
  now(),
  m.client_id
FROM tmp_shared_shift_map m
JOIN public.shifts s ON s.id = m.original_shift_id
LEFT JOIN public.shifts existing ON existing.id = m.new_shift_id
WHERE existing.id IS NULL;

UPDATE public.roster r
SET shift_id = m.new_shift_id
FROM public.employees e
JOIN tmp_shared_shift_map m
  ON m.original_shift_id = r.shift_id
 AND m.client_id = e.client_id
WHERE r.employee_id = e.id;

-- Remove the now-global shared shift rows after roster pointers move away.
DELETE FROM public.shifts s
USING tmp_shift_usage_count c
WHERE s.id = c.shift_id
  AND c.client_count > 1
  AND NOT EXISTS (
    SELECT 1 FROM public.roster r WHERE r.shift_id = s.id
  );

COMMIT;

-- Review any legacy shifts that were never referenced in roster and therefore could not be safely auto-owned.
-- These will be hidden by the patched app until you either assign or recreate them.
SELECT *
FROM public.shifts
WHERE client_id IS NULL
ORDER BY label, id;
