-- Weihnachtswichteln: Schema + RPC-API
-- Alle Tabellen sind per RLS für anon/authenticated komplett gesperrt.
-- Zugriff läuft ausschließlich über SECURITY DEFINER Funktionen, die geheime Tokens prüfen.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique,
  admin_token text not null unique,
  budget text,
  event_date text,
  message text,
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token text not null unique,
  wishlist text not null default '',
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index participants_group_name_uq on public.participants (group_id, lower(name));
create index participants_group_idx on public.participants (group_id);

-- Ausschlüsse gelten in beide Richtungen (z.B. Paare)
create table public.exclusions (
  group_id uuid not null references public.groups(id) on delete cascade,
  a_id uuid not null references public.participants(id) on delete cascade,
  b_id uuid not null references public.participants(id) on delete cascade,
  primary key (a_id, b_id),
  check (a_id < b_id)
);
create index exclusions_group_idx on public.exclusions (group_id);

create table public.assignments (
  group_id uuid not null references public.groups(id) on delete cascade,
  giver_id uuid primary key references public.participants(id) on delete cascade,
  receiver_id uuid not null references public.participants(id) on delete cascade
);
create index assignments_group_idx on public.assignments (group_id);
create index assignments_receiver_idx on public.assignments (receiver_id);

alter table public.groups enable row level security;
alter table public.participants enable row level security;
alter table public.exclusions enable row level security;
alter table public.assignments enable row level security;

revoke all on public.groups, public.participants, public.exclusions, public.assignments from anon, authenticated;

-- ---------- Helfer ----------

create or replace function public._token() returns text
language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public._join_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from groups where join_code = code);
  end loop;
  return code;
end $$;

create or replace function public._admin_group(p_admin_token text) returns groups
language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where admin_token = p_admin_token;
  if not found then raise exception 'Ungültiger Admin-Link' using errcode = 'P0001'; end if;
  return g;
end $$;

create or replace function public._participants_json(p_group uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by lower(name)), '[]'::jsonb)
  from participants where group_id = p_group;
$$;

-- ---------- Öffentliche API ----------

create or replace function public.create_group(p_name text, p_admin_name text, p_budget text default null, p_event_date text default null, p_message text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare g groups; pt text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte einen Gruppennamen angeben' using errcode = 'P0001'; end if;
  if coalesce(trim(p_admin_name), '') = '' then raise exception 'Bitte deinen Namen angeben' using errcode = 'P0001'; end if;
  insert into groups (name, join_code, admin_token, budget, event_date, message)
  values (trim(p_name), _join_code(), _token(), nullif(trim(p_budget), ''), nullif(trim(p_event_date), ''), nullif(trim(p_message), ''))
  returning * into g;
  pt := _token();
  insert into participants (group_id, name, token) values (g.id, trim(p_admin_name), pt);
  return jsonb_build_object('admin_token', g.admin_token, 'join_code', g.join_code, 'participant_token', pt);
end $$;

create or replace function public.get_group(p_join_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where join_code = upper(trim(p_join_code));
  if not found then raise exception 'Gruppe nicht gefunden' using errcode = 'P0001'; end if;
  return jsonb_build_object('name', g.name, 'budget', g.budget, 'event_date', g.event_date, 'message', g.message,
    'drawn', g.drawn_at is not null, 'participants', _participants_json(g.id));
end $$;

create or replace function public.join_group(p_join_code text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare g groups; pt text;
begin
  select * into g from groups where join_code = upper(trim(p_join_code));
  if not found then raise exception 'Gruppe nicht gefunden' using errcode = 'P0001'; end if;
  if g.drawn_at is not null then raise exception 'Die Auslosung hat schon stattgefunden – bitte den Organisator fragen' using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte deinen Namen angeben' using errcode = 'P0001'; end if;
  if exists (select 1 from participants where group_id = g.id and lower(name) = lower(trim(p_name))) then
    raise exception 'Dieser Name ist schon angemeldet. Hast du deinen Link verloren? Der Organisator kann ihn dir schicken.' using errcode = 'P0001';
  end if;
  if (select count(*) from participants where group_id = g.id) >= 100 then
    raise exception 'Die Gruppe ist voll' using errcode = 'P0001';
  end if;
  pt := _token();
  insert into participants (group_id, name, token) values (g.id, trim(p_name), pt);
  return jsonb_build_object('participant_token', pt);
end $$;

create or replace function public.get_me(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p participants; g groups; r participants;
begin
  select * into p from participants where token = p_token;
  if not found then raise exception 'Ungültiger persönlicher Link' using errcode = 'P0001'; end if;
  select * into g from groups where id = p.group_id;
  select rp.* into r from assignments a join participants rp on rp.id = a.receiver_id where a.giver_id = p.id;
  if r.id is not null and p.seen_at is null then
    update participants set seen_at = now() where id = p.id;
  end if;
  return jsonb_build_object(
    'name', p.name, 'wishlist', p.wishlist,
    'group', jsonb_build_object('name', g.name, 'join_code', g.join_code, 'budget', g.budget, 'event_date', g.event_date,
      'message', g.message, 'drawn', g.drawn_at is not null),
    'participants', _participants_json(g.id),
    'receiver', case when r.id is null then null else jsonb_build_object('name', r.name, 'wishlist', r.wishlist) end);
end $$;

create or replace function public.update_wishlist(p_token text, p_wishlist text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update participants set wishlist = left(coalesce(p_wishlist, ''), 2000) where token = p_token;
  if not found then raise exception 'Ungültiger persönlicher Link' using errcode = 'P0001'; end if;
end $$;

-- ---------- Admin-API ----------

create or replace function public.admin_get(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  return jsonb_build_object(
    'name', g.name, 'join_code', g.join_code, 'budget', g.budget, 'event_date', g.event_date, 'message', g.message,
    'drawn', g.drawn_at is not null, 'drawn_at', g.drawn_at,
    'participants', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'token', token, 'seen', seen_at is not null, 'has_wishlist', wishlist <> '') order by lower(name)), '[]'::jsonb)
      from participants where group_id = g.id),
    'exclusions', (select coalesce(jsonb_agg(jsonb_build_object('a', a_id, 'b', b_id)), '[]'::jsonb)
      from exclusions where group_id = g.id));
end $$;

create or replace function public.admin_update_group(p_admin_token text, p_name text, p_budget text, p_event_date text, p_message text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte einen Gruppennamen angeben' using errcode = 'P0001'; end if;
  update groups set name = trim(p_name), budget = nullif(trim(p_budget), ''), event_date = nullif(trim(p_event_date), ''),
    message = nullif(trim(p_message), '') where id = g.id;
end $$;

create or replace function public.admin_add_participant(p_admin_token text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare g groups; pt text;
begin
  g := _admin_group(p_admin_token);
  if g.drawn_at is not null then raise exception 'Erst die Auslosung zurücksetzen' using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte einen Namen angeben' using errcode = 'P0001'; end if;
  if exists (select 1 from participants where group_id = g.id and lower(name) = lower(trim(p_name))) then
    raise exception 'Dieser Name ist schon angemeldet' using errcode = 'P0001';
  end if;
  pt := _token();
  insert into participants (group_id, name, token) values (g.id, trim(p_name), pt);
  return jsonb_build_object('participant_token', pt);
end $$;

create or replace function public.admin_remove_participant(p_admin_token text, p_participant_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  if g.drawn_at is not null then raise exception 'Erst die Auslosung zurücksetzen' using errcode = 'P0001'; end if;
  delete from participants where id = p_participant_id and group_id = g.id;
end $$;

create or replace function public.admin_set_exclusion(p_admin_token text, p_a uuid, p_b uuid, p_excluded boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups; lo uuid; hi uuid;
begin
  g := _admin_group(p_admin_token);
  if g.drawn_at is not null then raise exception 'Erst die Auslosung zurücksetzen' using errcode = 'P0001'; end if;
  if p_a = p_b then return; end if;
  if (select count(*) from participants where group_id = g.id and id in (p_a, p_b)) <> 2 then
    raise exception 'Teilnehmer nicht gefunden' using errcode = 'P0001';
  end if;
  lo := least(p_a, p_b); hi := greatest(p_a, p_b);
  if p_excluded then
    insert into exclusions (group_id, a_id, b_id) values (g.id, lo, hi) on conflict do nothing;
  else
    delete from exclusions where a_id = lo and b_id = hi;
  end if;
end $$;

create or replace function public.admin_draw(p_admin_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g groups;
  ids uuid[];
  perm uuid[];
  n int;
  ok boolean;
  attempt int;
  i int;
  use_cycle boolean;
begin
  g := _admin_group(p_admin_token);
  if g.drawn_at is not null then raise exception 'Es wurde bereits ausgelost' using errcode = 'P0001'; end if;
  select array_agg(id) into ids from participants where group_id = g.id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 3 then raise exception 'Für eine Auslosung braucht es mindestens 3 Teilnehmer' using errcode = 'P0001'; end if;

  for attempt in 1..20000 loop
    select array_agg(x order by random()) into ids from unnest(ids) x;
    -- Bevorzugt ein großer Kreis (keine gegenseitigen Paare), danach beliebige gültige Zuordnung
    use_cycle := attempt <= 10000;
    if use_cycle then
      perm := ids[2:n] || ids[1];
    else
      select array_agg(x order by random()) into perm from unnest(ids) x;
    end if;
    ok := true;
    for i in 1..n loop
      if ids[i] = perm[i] or exists (
        select 1 from exclusions where a_id = least(ids[i], perm[i]) and b_id = greatest(ids[i], perm[i])) then
        ok := false; exit;
      end if;
    end loop;
    if ok then
      insert into assignments (group_id, giver_id, receiver_id)
      select g.id, ids[k], perm[k] from generate_subscripts(ids, 1) k;
      update groups set drawn_at = now() where id = g.id;
      update participants set seen_at = null where group_id = g.id;
      return jsonb_build_object('ok', true, 'count', n);
    end if;
  end loop;
  raise exception 'Mit diesen Ausschlüssen ist keine gültige Auslosung möglich. Bitte ein paar Ausschlüsse entfernen.' using errcode = 'P0001';
end $$;

create or replace function public.admin_reset_draw(p_admin_token text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  delete from assignments where group_id = g.id;
  update groups set drawn_at = null where id = g.id;
  update participants set seen_at = null where group_id = g.id;
end $$;

-- ---------- Rechte ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.create_group(text, text, text, text, text),
  public.get_group(text),
  public.join_group(text, text),
  public.get_me(text),
  public.update_wishlist(text, text),
  public.admin_get(text),
  public.admin_update_group(text, text, text, text, text),
  public.admin_add_participant(text, text),
  public.admin_remove_participant(text, uuid),
  public.admin_set_exclusion(text, uuid, uuid, boolean),
  public.admin_draw(text),
  public.admin_reset_draw(text)
to anon, authenticated;

-- ---------- Gruppe löschen ----------
create or replace function public.admin_delete_group(p_admin_token text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  delete from groups where id = g.id;
end $$;
revoke execute on function public.admin_delete_group(text) from public, anon, authenticated;
grant execute on function public.admin_delete_group(text) to anon, authenticated;
