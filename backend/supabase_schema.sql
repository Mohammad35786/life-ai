-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- ── Users profile table ───────────────────────────────────────────────────
-- Mirrors auth.users so we can store extra profile data later.
-- user_id is the same UUID as auth.users(id).
create table if not exists users (
    id uuid references auth.users on delete cascade primary key,
    email text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Goals table ───────────────────────────────────────────────────────────
create table if not exists goals (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references users(id) on delete cascade,
    title text not null,
    description text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Plans table ───────────────────────────────────────────────────────────
create table if not exists plans (
    id uuid default uuid_generate_v4() primary key,
    goal_id uuid references goals(id) on delete cascade,
    user_id uuid references users(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Tasks table ───────────────────────────────────────────────────────────
create table if not exists tasks (
    id uuid default uuid_generate_v4() primary key,
    plan_id uuid references plans(id) on delete cascade,
    title text not null,
    due_date date,
    status text not null default 'todo',
    priority text not null default 'medium',
    parent_id uuid references tasks(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Roadmap Folders table ─────────────────────────────────────────────────
create table if not exists roadmap_folders (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references users(id) on delete cascade,
    name text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Roadmaps table ────────────────────────────────────────────────────────
create table if not exists roadmaps (
    id uuid default uuid_generate_v4() primary key,
    folder_id uuid references roadmap_folders(id) on delete set null,
    user_id uuid references users(id) on delete cascade,
    title text not null,
    topic text not null,
    difficulty text not null,
    provider text not null,
    data jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ── Conversations table ───────────────────────────────────────────────────
-- Each row = one full chat session. messages stored as JSONB array.
create table if not exists conversations (
    id          uuid default uuid_generate_v4() primary key,
    user_id     uuid references auth.users(id) on delete cascade not null,
    title       text not null default 'New Conversation',
    messages    jsonb not null default '[]'::jsonb,
    created_at  timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at  timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Row Level Security — users can only see their own conversations
alter table conversations enable row level security;

drop policy if exists "Users own conversations" on conversations;
create policy "Users own conversations"
    on conversations for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$ language plpgsql;

drop trigger if exists conversations_updated_at on conversations;
create trigger conversations_updated_at
    before update on conversations
    for each row execute function update_updated_at_column();

-- Legacy chat_history table kept for reference (not actively used)
create table if not exists chat_history (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references users(id) on delete cascade,
    role text not null,
    content text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
