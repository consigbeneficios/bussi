create table bussi_internal.recebimentos_admin (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table bussi_internal.recebimentos_admin enable row level security;
revoke all on bussi_internal.recebimentos_admin from public, anon, authenticated;

-- Pin the existing operator at installation. Future signups never acquire access.
do $$
declare operator_id uuid;
begin
  select u.id into strict operator_id from auth.users u
  where u.email_confirmed_at is not null and exists (
    select 1 from auth.mfa_factors f where f.user_id = u.id
      and f.factor_type = 'totp' and f.status = 'verified'
  );
  insert into bussi_internal.recebimentos_admin values (operator_id);
end $$;

create function public.bussi_resumo_recebimentos() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.jwt()->>'aal' is distinct from 'aal2' or not exists (
    select 1 from bussi_internal.recebimentos_admin a
    join auth.sessions s on s.user_id = a.user_id
    where a.user_id = auth.uid() and s.id::text = (auth.jwt()->>'session_id')
  ) then
    raise exception 'Acesso administrativo com MFA necessário' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('quantidade', count(*),
      'total_centavos', coalesce(sum(amount_minor),0)::text)
    from bussi_internal.payment_reconciliation
    where currency = 'BRL'
  );
end $$;
revoke all on function public.bussi_resumo_recebimentos() from public, anon;
grant execute on function public.bussi_resumo_recebimentos() to authenticated;
