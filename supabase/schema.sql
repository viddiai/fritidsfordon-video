-- Schema för fordonsvideor. Körs automatiskt vid start (idempotent),
-- men kan också klistras in i Supabase SQL Editor.

create table if not exists vehicles (
  id            text primary key,          -- Emporis pageId / produkt-id (t.ex. 54103)
  unique_id     text not null,             -- Emporis GUID (används mot dsoApi/v1/object/{guid})
  type          smallint not null,         -- 1 = husvagn, 2 = husbil
  title         text not null,
  filial        text,
  page_url      text,
  price         numeric,
  sale_price    numeric,
  status        text not null default 'active',   -- active | sold
  data          jsonb not null,            -- normaliserad fordonsdata (det mallen använder)
  detail        jsonb,                     -- säljtext, utrustning m.m. från detaljsidan
  video_hash    text,                      -- hash av videorelevanta fält; ändras -> ny video
  site_created  timestamptz,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  sold_at       timestamptz
);
create index if not exists vehicles_status_idx on vehicles(status);

-- En rad per video (båda formaten). Tabellen fungerar också som renderingskö.
create table if not exists videos (
  id              serial primary key,
  vehicle_id      text not null references vehicles(id) on delete cascade,
  variant         text not null default 'listing',  -- listing | sold
  status          text not null default 'queued',   -- queued | rendering | review | approved | rejected | failed | superseded
  priority        int not null default 100,         -- lägre = tidigare
  attempts        int not null default 0,
  script          jsonb,      -- manus, bildval och ljudsegment
  file_vertical   text,       -- relativ sökväg i storage, 9:16
  file_landscape  text,       -- relativ sökväg i storage, 16:9
  duration_s      numeric,
  error           text,
  review_note     text,
  locked_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  approved_at     timestamptz
);
create index if not exists videos_queue_idx on videos(status, priority, created_at);
create index if not exists videos_vehicle_idx on videos(vehicle_id, created_at desc);

create table if not exists sync_runs (
  id          serial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  seen        int, created int, updated int, sold int, queued int,
  error       text
);
