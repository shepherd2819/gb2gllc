-- 030_proposals.sql — Sawyer proposal composer
create table proposals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete set null,
  prospect_name text,
  title         text not null,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','declined')),
  sections      jsonb not null default '[]'::jsonb,
  pricing       jsonb,
  markdown      text,
  public_token  text unique not null,
  viewed_at     timestamptz,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index proposals_client_id_idx on proposals(client_id);
create index proposals_status_idx on proposals(status);

create table proposal_messages (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index proposal_messages_proposal_id_idx on proposal_messages(proposal_id);

alter table proposals         enable row level security;
alter table proposal_messages enable row level security;
create policy prop_service_role_only         on proposals         for all using (false);
create policy prop_messages_service_role_only on proposal_messages for all using (false);
