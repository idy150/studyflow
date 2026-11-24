-- =====================================================================
-- StudyFlow : base de données Supabase
-- À coller dans Supabase → SQL Editor → New query → Run (une seule fois).
-- Peut être relancé sans danger (idempotent).
-- =====================================================================

-- 1) Profils (un par compte) -----------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  trial_start timestamptz,          -- début de l'essai gratuit (null = pas encore commencé)
  premium_until timestamptz,        -- fin de l'abonnement payé
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Fonction utilitaire : l'utilisateur courant est-il admin ?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;


drop policy if exists "profil: lire le sien" on public.profiles;
create policy "profil: lire le sien" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profil: modifier le sien" on public.profiles;
create policy "profil: modifier le sien" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- L'étudiant ne peut modifier QUE son nom (pas l'essai, l'abonnement ni le rôle admin).
revoke update on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

-- Création automatique du profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Démarrer l'essai gratuit (une seule fois par compte)
create or replace function public.start_trial()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  update public.profiles set trial_start = now() where id = auth.uid() and trial_start is null;
end $$;

-- 2) Paiements (déclarés par l'étudiant, validés par l'admin) ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan text not null,                    -- 'mois', 'trimestre', 'annee'
  days int not null check (days between 1 and 400),
  amount int not null check (amount >= 0),
  method text not null,                  -- 'bankily', 'masrvi', 'sedad'
  reference text not null check (length(reference) between 3 and 80), -- n° de transaction
  phone text check (phone is null or length(phone) <= 30),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.payments enable row level security;

drop policy if exists "paiement: voir les siens" on public.payments;
create policy "paiement: voir les siens" on public.payments
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "paiement: déclarer" on public.payments;
create policy "paiement: déclarer" on public.payments
  for insert with check (auth.uid() = user_id and status = 'pending' and decided_at is null);

revoke update, delete on public.payments from anon, authenticated;

-- Valider un paiement → prolonge l'abonnement
create or replace function public.approve_payment(p_id uuid, p_days int default null)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into pay from public.payments where id = p_id for update;
  if pay.id is null then raise exception 'Paiement introuvable'; end if;
  if pay.status <> 'pending' then raise exception 'Paiement déjà traité'; end if;
  update public.payments set status = 'approved', decided_at = now() where id = p_id;
  update public.profiles
     set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => coalesce(p_days, pay.days))
   where id = pay.user_id;
end $$;

create or replace function public.reject_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  update public.payments set status = 'rejected', decided_at = now() where id = p_id and status = 'pending';
end $$;

-- 3) Consommation de l'IA (quotas par jour) ---------------------------
create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "usage: voir le sien" on public.ai_usage;
create policy "usage: voir le sien" on public.ai_usage for select using (auth.uid() = user_id or public.is_admin());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- Incrément atomique, appelé uniquement par le serveur IA (clé service)
create or replace function public.bump_usage(p_user uuid, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  if n > p_limit then
    update public.ai_usage set count = count - 1 where user_id = p_user and day = current_date;
    return -1;
  end if;
  return n;
end $$;
revoke execute on function public.bump_usage(uuid, int) from public, anon, authenticated;

-- 4) Statistiques pour la page admin ----------------------------------
create or replace function public.admin_stats()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'premium', (select count(*) from public.profiles where premium_until > now()),
    'trial', (select count(*) from public.profiles where trial_start > now() - interval '7 days' and (premium_until is null or premium_until < now())),
    'pending', (select count(*) from public.payments where status = 'pending'),
    'revenue_month', (select coalesce(sum(amount), 0) from public.payments where status = 'approved' and decided_at > date_trunc('month', now())),
    'ai_today', (select coalesce(sum(count), 0) from public.ai_usage where day = current_date)
  );
end $$;

-- =====================================================================
-- Ensuite, pour devenir administrateur (remplace l'e-mail) :
--   update public.profiles set is_admin = true where email = 'ton.email@exemple.com';
-- =====================================================================
