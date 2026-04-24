-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 8: Add insight_json column to milestones table
-- Caches the LLM-generated milestone insight so it doesn't re-call the LLM
-- every time a user views a milestone. Invalidated when milestone data changes.
-- Run AFTER 007_add_milestone_suggested_days_outcome.sql
-- ═══════════════════════════════════════════════════════════════════════════════

alter table milestones add column if not exists insight_json jsonb;
