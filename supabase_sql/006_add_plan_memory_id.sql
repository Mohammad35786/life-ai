-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 6: Add missing columns to plans table
-- memory_id: links plan to the memory row (separate from goal_id FK to goals)
-- duration_days: plan duration set during interactive setup
-- schedule_prefs: schedule preferences (JSON) set during interactive setup
-- ═══════════════════════════════════════════════════════════════════════════════

alter table plans add column if not exists memory_id uuid references memory(id) on delete set null;
alter table plans add column if not exists duration_days integer;
alter table plans add column if not exists schedule_prefs jsonb;
