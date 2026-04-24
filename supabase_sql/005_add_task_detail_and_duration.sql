-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 5: Add detail_json and duration_minutes columns to tasks table
-- Run AFTER 004_add_milestones.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Add detail_json for lazy-generated task detail ──────────────────────────
alter table tasks add column if not exists detail_json jsonb;

-- ── Add duration_minutes for estimated task duration ────────────────────────
alter table tasks add column if not exists duration_minutes integer;

-- ── Add description to tasks (used by milestone-structured plan generator) ──
alter table tasks add column if not exists description text;
