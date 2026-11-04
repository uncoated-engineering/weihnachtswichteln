-- Vereinfachung: eine Familiengruppe, Anmeldung mit Name + 4-stelliger PIN.

alter table public.participants add column pin_hash text;
alter table public.participants add column failed_attempts int not null default 0;

create or replace function public._check_pin(p_pin text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'Die PIN muss aus 4 Ziffern bestehen' using errcode = 'P0001';
  end if;
end $$;

-- Familie laden (öffentlich, über den Gruppencode aus der Seite)
create or replace function public.family_get(p_join_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where join_code = upper(trim(p_join_code));
  if not found then raise exception 'Gruppe nicht gefunden' using errcode = 'P0001'; end if;
  return jsonb_build_object('name', g.name, 'budget', g.budget, 'event_date', g.event_date, 'message', g.message,
    'drawn', g.drawn_at is not null,
    'participants', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'has_pin', pin_hash is not null)
      order by lower(name)), '[]'::jsonb) from participants where group_id = g.id));
end $$;

-- Neu dabei: Name + PIN
create or replace function public.family_join(p_join_code text, p_name text, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare g groups; pt text;
begin
  select * into g from groups where join_code = upper(trim(p_join_code));
  if not found then raise exception 'Gruppe nicht gefunden' using errcode = 'P0001'; end if;
  if g.drawn_at is not null then raise exception 'Es wurde schon ausgelost – neu anmelden geht nicht mehr' using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte deinen Namen eingeben' using errcode = 'P0001'; end if;
  perform _check_pin(p_pin);
  if exists (select 1 from participants where group_id = g.id and lower(name) = lower(trim(p_name))) then
    raise exception 'Diesen Namen gibt es schon – tippe oben auf deinen Namen' using errcode = 'P0001';
  end if;
  if (select count(*) from participants where group_id = g.id) >= 60 then
    raise exception 'Die Liste ist voll' using errcode = 'P0001';
  end if;
  pt := _token();
  insert into participants (group_id, name, token, pin_hash)
  values (g.id, trim(p_name), pt, crypt(p_pin, gen_salt('bf')));
  return jsonb_build_object('participant_token', pt);
end $$;

-- Wieder da: Name antippen + PIN. Ohne gesetzte PIN wird die eingegebene neu gesetzt.
create or replace function public.family_login(p_join_code text, p_participant_id uuid, p_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare g groups; p participants;
begin
  select * into g from groups where join_code = upper(trim(p_join_code));
  if not found then raise exception 'Gruppe nicht gefunden' using errcode = 'P0001'; end if;
  select * into p from participants where id = p_participant_id and group_id = g.id;
  if not found then raise exception 'Name nicht gefunden' using errcode = 'P0001'; end if;
  perform _check_pin(p_pin);
  if p.pin_hash is null then
    update participants set pin_hash = crypt(p_pin, gen_salt('bf')), failed_attempts = 0 where id = p.id;
    return jsonb_build_object('participant_token', p.token, 'pin_set', true);
  end if;
  if p.failed_attempts >= 8 then
    raise exception 'Zu oft falsch. Der Organisator kann deine PIN zurücksetzen.' using errcode = 'P0001';
  end if;
  if crypt(p_pin, p.pin_hash) <> p.pin_hash then
    update participants set failed_attempts = failed_attempts + 1 where id = p.id;
    raise exception 'Die PIN stimmt nicht' using errcode = 'P0001';
  end if;
  update participants set failed_attempts = 0 where id = p.id;
  return jsonb_build_object('participant_token', p.token, 'pin_set', false);
end $$;

create or replace function public.admin_reset_pin(p_admin_token text, p_participant_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  update participants set pin_hash = null, failed_attempts = 0 where id = p_participant_id and group_id = g.id;
  if not found then raise exception 'Teilnehmer nicht gefunden' using errcode = 'P0001'; end if;
end $$;

create or replace function public.admin_get(p_admin_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  g := _admin_group(p_admin_token);
  return jsonb_build_object(
    'name', g.name, 'join_code', g.join_code, 'budget', g.budget, 'event_date', g.event_date, 'message', g.message,
    'drawn', g.drawn_at is not null, 'drawn_at', g.drawn_at,
    'participants', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'seen', seen_at is not null, 'has_wishlist', wishlist <> '',
        'has_pin', pin_hash is not null, 'locked', failed_attempts >= 8) order by lower(name)), '[]'::jsonb)
      from participants where group_id = g.id),
    'exclusions', (select coalesce(jsonb_agg(jsonb_build_object('a', a_id, 'b', b_id)), '[]'::jsonb)
      from exclusions where group_id = g.id));
end $$;

-- Alte Mehrgruppen-/Link-Funktionen nicht mehr öffentlich
revoke execute on function public.create_group(text, text, text, text, text), public.get_group(text),
  public.join_group(text, text), public.admin_delete_group(text) from anon, authenticated;
revoke execute on function public._check_pin(text) from public, anon, authenticated;
grant execute on function public.family_get(text), public.family_join(text, text, text),
  public.family_login(text, uuid, text), public.admin_reset_pin(text, uuid) to anon, authenticated;
