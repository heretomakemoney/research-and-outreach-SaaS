-- Step 3: the five V1 tables (docs/DATA_MODEL.md, "Phase 2 implementation").
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- It is safe to run twice (nothing is dropped or overwritten).
--
-- Plain PostgreSQL only. Row-level security is switched ON with no policies, so nobody can read these
-- tables through Supabase's public API; only the server (which connects with DATABASE_URL) can.

create table if not exists companies (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null check (length(btrim(name)) > 0),
  website                    text not null default '',
  context                    text not null default '',          -- persistent, remembered about the account
  context_updated_at         timestamptz not null default now(),
  selected_run_id            uuid,                              -- the current selection (Research tab -> Outreach tab)
  selected_angle_key         text,                              -- e.g. 'A1'
  selected_person_key        text,                              -- e.g. 'P1'
  selected_manual_contact_id uuid,
  last_activity_at           timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (selected_person_key is null or selected_manual_contact_id is null) -- at most one contact
);

create table if not exists research_runs (
  id                    uuid primary key default gen_random_uuid(),
  seq                   bigint generated always as identity,    -- tie-breaker for "newest run"
  company_id            uuid not null references companies(id) on delete cascade,
  status                text not null check (status in ('researching','done','partial','failed')),
  status_reason         text,
  -- what the run was given; editing the company later never changes these
  company_name_snapshot text not null,
  website_snapshot      text not null default '',
  context_snapshot      text not null default '',
  topic                 text not null default '',               -- this run's instruction only
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  updated_at            timestamptz not null default now(),     -- last write; used to spot abandoned runs
  ai_mode               text not null check (ai_mode in ('live','mock','unknown')),
  -- summary columns (the Accounts table reads these without loading the JSON)
  overview              text,
  industry              text,
  client_type           text,
  top_signal            text check (top_signal is null or top_signal in ('strong','medium','weak','hook','none')),
  verdict_line          text,
  total_cost_usd        numeric(10,4) not null default 0,
  total_searches        integer not null default 0,
  -- the whole result, stored in full
  research              jsonb not null,
  synthesis             jsonb,
  synthesis_log         jsonb,
  gate_log              jsonb not null default '[]'::jsonb,
  next_step             jsonb
);
create index if not exists research_runs_company_idx on research_runs (company_id, started_at desc, seq desc);

create table if not exists manual_contacts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  role       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists manual_contacts_unique_idx on manual_contacts (company_id, lower(name), lower(role));

create table if not exists outreach_emails (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null unique references companies(id) on delete cascade, -- one current email per company
  run_id              uuid references research_runs(id) on delete set null,
  angle_key           text not null,
  angle_title         text not null,
  angle_strength      text not null,
  contact_origin      text not null check (contact_origin in ('researched','manual')),
  contact_name        text not null,
  contact_role        text not null default '',
  contact_person_key  text,
  relationship_kind   text not null check (relationship_kind in ('new','existing')), -- new = first contact
  relationship_note   text not null default '',
  subject             text not null,
  body                text not null,
  generated_subject   text not null,
  generated_body      text not null,
  used_card_ids       jsonb not null default '[]'::jsonb,
  based_on            jsonb not null default '[]'::jsonb,
  limitation          text not null check (limitation in ('none','weak_hook','fallback_general')),
  generation          integer not null default 1,
  generated_at        timestamptz not null,
  edited_at           timestamptz,
  updated_at          timestamptz not null default now()
);

-- One row per logged stage (research rounds, synthesis, every email generation). Append-only.
create table if not exists stage_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  run_id      uuid references research_runs(id) on delete cascade,  -- null for email generations
  stage       text not null,
  round       integer not null default 1,
  model       text,
  cost_usd    numeric(10,4) not null default 0,
  duration_ms integer not null default 0,
  started_at  timestamptz not null,
  log         jsonb not null,
  unique (company_id, stage, round, started_at)
);

-- Circular references, added after both tables exist. Guarded so the file can be run twice.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_selected_run_fk') then
    alter table companies add constraint companies_selected_run_fk
      foreign key (selected_run_id) references research_runs(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'companies_selected_contact_fk') then
    alter table companies add constraint companies_selected_contact_fk
      foreign key (selected_manual_contact_id) references manual_contacts(id) on delete set null;
  end if;
end $$;

alter table companies       enable row level security;
alter table research_runs   enable row level security;
alter table manual_contacts enable row level security;
alter table outreach_emails enable row level security;
alter table stage_logs      enable row level security;
