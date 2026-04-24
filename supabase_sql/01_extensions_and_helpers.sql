-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Extensions & Helper Functions
-- Run this FIRST — required by all subsequent scripts.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── updated_at auto-trigger function ─────────────────────────────────────────
-- Used by multiple tables to keep updated_at in sync automatically.
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$ language plpgsql;
