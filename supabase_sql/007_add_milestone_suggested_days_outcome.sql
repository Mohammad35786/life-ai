-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 7: Add suggested_days and outcome columns to milestones table
-- These are required by milestone_generator.py but were missing from the schema.
-- Run AFTER 004_add_milestones.sql
-- ═══════════════════════════════════════════════════════════════════════════════

alter table milestones add column if not exists suggested_days integer;
alter table milestones add column if not exists outcome text;
