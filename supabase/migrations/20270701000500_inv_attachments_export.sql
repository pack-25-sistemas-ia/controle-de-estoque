-- Controle de Estoque Inteligente — ANEXOS (Storage privado) e REGISTRO DE EXPORTAÇÕES (parte 6).
-- Arquivo em bucket PRIVADO (caminho «<organização>/<uuid>.<ext>» gerado pelo servidor); metadados aqui; leitura só por URL assinada curta.
-- Imagem do produto = anexo do tipo product_image (PNG/JPEG até 5 MB); documentos de operação/inventário = PDF/PNG/JPEG até 10 MB.

begin;
set local check_function_bodies = off;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('product_image', 'operation', 'count')),
  entity_id uuid not null,
  original_file_name text not null check (char_length(original_file_name) between 1 and 200),
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg)$'),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  unique (storage_path),
  check (split_part(storage_path, '/', 1) = organization_id::text),
  check (entity_type <> 'product_image' or (mime_type in ('image/png', 'image/jpeg') and size_bytes <= 5242880))
);
create index attachments_entity_idx on public.attachments (organization_id, entity_type, entity_id);
alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
create policy attachments_select on public.attachments for select to authenticated using (private.inv_can_read(organization_id));

create function private.inv_attachment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
    raise exception 'metadados do anexo são imutáveis (apenas o arquivamento muda)' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.inv_attachment_guard() from public, anon, authenticated;
create trigger attachment_guard before update on public.attachments for each row execute function private.inv_attachment_guard();
create trigger nodel_attachments before delete on public.attachments for each row execute function private.inv_no_delete();

-- O servidor envia o arquivo ao Storage (já validado pelos bytes) e então registra; o banco confere vínculo e empresa.
create function public.inv_register_attachment(p_org uuid, p_entity_type text, p_entity_id uuid, p_name text, p_path text, p_mime text, p_size integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid; n integer;
begin
  perform private.inv_guard(p_org, 'operator');
  if p_entity_type = 'product_image' then
    if not exists (select 1 from public.products where id = p_entity_id and organization_id = p_org and archived_at is null) then raise exception 'produto não encontrado' using errcode = '22023'; end if;
  elsif p_entity_type = 'operation' then
    if not exists (select 1 from public.stock_operations where id = p_entity_id and organization_id = p_org) then raise exception 'operação não encontrada' using errcode = '22023'; end if;
  elsif p_entity_type = 'count' then
    if not exists (select 1 from public.physical_counts where id = p_entity_id and organization_id = p_org) then raise exception 'inventário não encontrado' using errcode = '22023'; end if;
  else
    raise exception 'tipo de anexo inválido' using errcode = '22023';
  end if;
  select count(*) into n from public.attachments where organization_id = p_org and entity_type = p_entity_type and entity_id = p_entity_id and archived_at is null;
  if n >= (case when p_entity_type = 'product_image' then 1 else 20 end) then
    raise exception '%', case when p_entity_type = 'product_image' then 'o produto já tem imagem (arquive a atual antes)' else 'limite de 20 anexos por registro' end using errcode = '55000';
  end if;
  insert into public.attachments (organization_id, entity_type, entity_id, original_file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values (p_org, p_entity_type, p_entity_id, left(regexp_replace(trim(p_name), '[[:cntrl:]]', '', 'g'), 200), p_path, p_mime, p_size, (select auth.uid())) returning attachments.id into new_id;
  if p_entity_type = 'product_image' then update public.products set image_path = p_path where id = p_entity_id; end if;
  return new_id;
exception when check_violation then raise exception 'anexo inválido (tipo, tamanho ou caminho)' using errcode = '22023';
end $$;

create function public.inv_archive_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attachments%rowtype;
begin
  select * into a from public.attachments where id = p_id for update;
  if not found then raise exception 'anexo não encontrado' using errcode = '22023'; end if;
  perform private.inv_guard(a.organization_id, case when a.entity_type = 'product_image' then 'operator' else 'manager' end);
  update public.attachments set archived_at = coalesce(archived_at, now()) where id = p_id;
  if a.entity_type = 'product_image' then update public.products set image_path = null where id = a.entity_id and image_path = a.storage_path; end if;
end $$;

-- ======================================================================= exportações (saída de informação: só gestão; auditada sem valores)
create function public.inv_log_export(p_org uuid, p_report text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.inv_guard(p_org, 'manager');
  if p_report is null or p_report !~ '^[a-z_]{3,40}$' then raise exception 'relatório inválido' using errcode = '22023'; end if;
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes)
  values (p_org, (select auth.uid()), 'export', p_report, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.inv_register_attachment(uuid, text, uuid, text, text, text, integer)', 'public.inv_archive_attachment(uuid)', 'public.inv_log_export(uuid, text, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ======================================================================= Storage privado (só se o schema storage existir: Supabase real/local)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('inv-files', 'inv-files', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg'];

    execute $f$create or replace function private.inv_storage_org(p_name text) returns uuid language sql immutable set search_path = '' as
      $b$ select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end $b$ $f$;
    execute 'revoke all on function private.inv_storage_org(text) from public';
    execute 'grant execute on function private.inv_storage_org(text) to authenticated';
    execute 'drop policy if exists inv_files_insert on storage.objects';
    execute 'drop policy if exists inv_files_select on storage.objects';
    execute $p$create policy inv_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'inv-files' and private.inv_storage_org(objects.name) is not null and private.inv_is_operator(private.inv_storage_org(objects.name)) and private.mfa_ok())$p$;
    execute $p$create policy inv_files_select on storage.objects for select to authenticated
      using (bucket_id = 'inv-files' and private.inv_storage_org(objects.name) is not null and private.inv_can_read(private.inv_storage_org(objects.name)))$p$;
  end if;
end $$;

commit;
