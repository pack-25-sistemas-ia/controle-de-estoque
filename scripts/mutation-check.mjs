#!/usr/bin/env node
// Teste de mutação das regras críticas do banco: quebra cada regra DE PROPÓSITO numa cópia das migrações
// e exige que a suíte reprove. Se alguma mutação sobreviver, falta teste.
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais; rode SEM outra carga na máquina)
// Cada mutação aponta para a definição VIVA (as migrações não redefinem funções umas das outras).
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

const GUARD_OPERATOR = "perform private.inv_guard(p_org, 'operator', p_warehouse);";
const GUARD_MANAGER_WH = "perform private.inv_guard(p_org, 'manager', p_warehouse);";
const DUP_PRODUCT = "if (select count(distinct z) from unnest(pr) z) <> n then raise exception 'o mesmo produto aparece mais de uma vez na operação' using errcode = '22023'; end if;";

// { name, file (trecho do arquivo), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // --- estoque negativo, saldo e escala
  { name: 'saída: aceita saldo insuficiente', file: 'inv_engine', nth: 1, find: 'if bal < qt[i] then', replace: 'if false then' },
  { name: 'transferência: aceita saldo insuficiente na origem', file: 'inv_engine', nth: 2, find: 'if bal < qt[i] then', replace: 'if false then' },
  { name: 'ajuste negativo: acima do saldo aceito', file: 'inv_engine', nth: 3, find: 'if bal < qt[i] then', replace: 'if false then' },
  { name: 'banco: saldo negativo sem check', file: 'inv_schema', find: 'quantity_on_hand numeric(18,3) not null default 0 check (quantity_on_hand >= 0),', replace: 'quantity_on_hand numeric(18,3) not null default 0,' },
  { name: 'banco: reserva aceita (fora do MVP)', file: 'inv_schema', find: 'check (quantity_reserved = 0)', replace: 'check (quantity_reserved >= 0)' },
  { name: 'unidade: escala de casas decimais ignorada', file: 'inv_engine', find: 'if p_qty <> round(p_qty, u.decimal_places) then', replace: 'if false then' },
  { name: 'produto arquivado recebe movimento', file: 'inv_engine', find: "if p.archived_at is not null or p.status <> 'active' then raise exception 'produto «%» está inativo ou arquivado e não recebe movimentação', p.sku using errcode = '55000'; end if;", replace: '' },
  { name: 'depósito arquivado recebe operação', file: 'inv_engine', find: "if not w.active then raise exception 'depósito «%» está arquivado e não recebe operações', w.name using errcode = '55000'; end if;", replace: '' },
  { name: 'operação aceita o mesmo produto duas vezes', file: 'inv_engine', nth: 2, find: DUP_PRODUCT, replace: '' },
  { name: 'data futura aceita', file: 'inv_engine', find: "if p_at > now() + interval '5 minutes' then raise exception 'a data da movimentação não pode estar no futuro' using errcode = '22023'; end if;", replace: '' },
  { name: 'perda sem observação aceita', file: 'inv_engine', find: "if p_reason in ('loss', 'damage', 'other_issue') and (p_notes is null or char_length(trim(p_notes)) < 5) then", replace: 'if false then' },
  // --- idempotência
  { name: 'idempotência: conteúdo diferente com a mesma chave aceito', file: 'inv_engine', find: "raise exception 'esta chave de operação já foi usada com outro conteúdo' using errcode = '23505';", replace: 'return ex.id;' },
  { name: 'idempotência: repetição não devolve a original', file: 'inv_engine', find: 'if ex.request_hash = p_hash then return ex.id; end if;', replace: '' },
  // --- custo médio e arredondamento
  { name: 'custo: média ignora o valor anterior', file: 'inv_engine', find: 'qn := cs.quantity_valued + p_qty_delta; vn := cs.total_value_cents + p_value_delta;', replace: 'qn := cs.quantity_valued + p_qty_delta; vn := p_value_delta;' },
  { name: 'custo: saída leva o valor integral', file: 'inv_engine', find: 'return private.inv_round_div(p_total_value::numeric * (p_qty * 1000), p_qty_valued * 1000);', replace: 'return p_total_value;' },
  { name: 'custo: arredondamento meio-para-cima', file: 'inv_guards', find: 'if 2 * r > d or (2 * r = d and mod(q, 2) = 1) then q := q + 1; end if;', replace: 'if 2 * r >= d then q := q + 1; end if;' },
  { name: 'custo: custo unitário com mais de 4 casas aceito', file: 'inv_engine', find: "if p_unit_cost <> round(p_unit_cost, 4) then raise exception 'custo unitário aceita no máximo 4 casas decimais (em centavos)' using errcode = '22023'; end if;", replace: '' },
  { name: 'custo: compra com custo zero sem marcar bonificação', file: 'inv_engine', find: "if p_reason = 'purchase' and uc[i] = 0 then raise exception 'custo zero em compra: marque «sem custo (bonificação)» em «%»', sku using errcode = '22023'; end if;", replace: '' },
  { name: 'custo: ajuste positivo inventa custo', file: 'inv_engine', find: "if cs.quantity_valued <= 0 then raise exception 'não há custo médio para «%»: informe o custo unitário (não se inventa custo)', sku using errcode = '22023'; end if;", replace: '' },
  // --- transferência
  { name: 'transferência: aceita origem = destino', file: 'inv_engine', find: 'if p_source is null or p_destination is null or p_source = p_destination then', replace: 'if p_source is null or p_destination is null then' },
  { name: 'transferência: perna de entrada ausente', file: 'inv_engine', find: "perform private.inv_post_move(p_org, op, it, pr[i], p_destination, 'transfer_in', null, qt[i], val, uc, 'average', null, p_notes, at_, false);", replace: '' },
  { name: 'transferência: altera o custo consolidado', file: 'inv_engine', find: "perform private.inv_post_move(p_org, op, it, pr[i], p_source, 'transfer_out', null, -qt[i], -val, uc, 'average', null, p_notes, at_, false);", replace: "perform private.inv_post_move(p_org, op, it, pr[i], p_source, 'transfer_out', null, -qt[i], -val, uc, 'average', null, p_notes, at_, true);" },
  // --- saldo inicial e ajustes
  { name: 'saldo inicial: duplicado aceito', file: 'inv_engine', find: "raise exception 'saldo inicial de «%» já lançado neste depósito (use entrada, ajuste ou estorne a abertura)', sku using errcode = '23505';", replace: 'null;' },
  { name: 'ajuste: sem justificativa', file: 'inv_engine', find: "if p_justification is null or char_length(trim(p_justification)) < 5 then raise exception 'informe a justificativa do ajuste (mínimo 5 caracteres)' using errcode = '22023'; end if;", replace: '' },
  // --- estorno
  { name: 'estorno: repetição aceita', file: 'inv_engine', find: "if o.status = 'reversed' then raise exception 'operação já estornada' using errcode = '55000'; end if;", replace: '' },
  { name: 'estorno: estorno do estorno aceito', file: 'inv_engine', find: "if o.operation_type = 'reversal' then raise exception 'um estorno não pode ser estornado' using errcode = '55000'; end if;", replace: '' },
  { name: 'estorno: saldo insuficiente ignorado', file: 'inv_engine', find: 'if bal < m.quantity_delta then', replace: 'if false then' },
  // --- permissões, MFA e isolamento
  { name: 'permissão: operador ajusta saldo', file: 'inv_engine', nth: 1, find: GUARD_MANAGER_WH, replace: GUARD_OPERATOR },
  { name: 'permissão: operador lança saldo inicial', file: 'inv_engine', nth: 2, find: GUARD_MANAGER_WH, replace: GUARD_OPERATOR },
  { name: 'permissão: operador estorna', file: 'inv_engine', find: "perform private.inv_guard(org, 'manager');", replace: "perform private.inv_guard(org, 'operator');" },
  { name: 'permissão: consulta movimenta o estoque', file: 'inv_engine', nth: 1, find: GUARD_OPERATOR, replace: "perform private.inv_guard(p_org, 'read', p_warehouse);" },
  { name: 'permissão: MFA ignorado nas funções', file: 'inv_guards', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;", replace: '' },
  { name: 'permissão: depósitos autorizados ignorados', file: 'inv_schema', find: "when 'member' then (not exists", replace: "when 'member' then (true or not exists" },
  { name: 'isolamento: papel sem filtrar a empresa', file: 'inv_schema', find: 'select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());', replace: 'select m.role from public.organization_members m where m.user_id = (select auth.uid()) limit 1;' },
  { name: 'isolamento: leitura aberta a todos', file: 'inv_schema', find: "using (private.inv_can_read(organization_id))', t || '_select', t);", replace: "using (true)', t || '_select', t);" },
  { name: 'cadastro: operador define parâmetros de reposição', file: 'inv_guards', find: "if not mgr and (new.minimum_stock is not null or new.reorder_point is not null or new.target_stock is not null or new.default_supplier_id is not null) then", replace: 'if false then' },
  { name: 'cadastro: produto com saldo é arquivado', file: 'inv_guards', find: "if stock <> 0 then raise exception 'produto com saldo em estoque não pode ser arquivado (zere o saldo antes)' using errcode = '55000'; end if;", replace: '' },
  { name: 'cadastro: unidade muda depois do primeiro movimento', file: 'inv_guards', find: "if moved then raise exception 'a unidade de medida não muda depois da primeira movimentação' using errcode = '23514'; end if;", replace: '' },
  { name: 'cadastro: código de barras com dígito errado', file: 'inv_guards', find: 'if g is false then raise exception', replace: 'if false then raise exception' },
  // --- imutabilidade
  { name: 'histórico: livro editável', file: 'inv_guards', find: "foreach t in array array['stock_movements', 'inventory_cost_events', 'stock_operation_items'] loop", replace: "foreach t in array array['inventory_cost_events', 'stock_operation_items'] loop" },
  { name: 'histórico: operação confirmada editável', file: 'inv_guards', find: "raise exception 'operação de estoque confirmada é imutável (só pode ser estornada)' using errcode = '23514';", replace: 'return new;' },
  // --- inventário físico
  { name: 'inventário: aprova com saldo desatualizado', file: 'inv_counts', find: 'if stale > 0 then', replace: 'if false then' },
  { name: 'inventário: dupla finalização', file: 'inv_counts', find: "if c.status = 'completed' then raise exception 'inventário já concluído' using errcode = '55000'; end if;", replace: '' },
  { name: 'inventário: sobra sem custo inventa valor', file: 'inv_counts', find: "raise exception 'informe o custo da sobra de «%» (não há custo médio para usar)', sku using errcode = '22023';", replace: 'val := 0; pol := $q$none$q$; uc := 0;' },
  // --- reposição
  { name: 'reposição: quantidade sugerida errada', file: 'inv_counts', find: 'sug := case when r.target is null then null else greatest(0, r.target - r.quantity) end;', replace: 'sug := case when r.target is null then null else r.target end;' },
  { name: 'reposição: limite do mínimo exclusivo', file: 'inv_counts', find: "when p_min is not null and p_qty <= p_min then 'critical'", replace: "when p_min is not null and p_qty < p_min then 'critical'" },
  { name: 'reposição: limite do ponto de reposição exclusivo', file: 'inv_counts', find: "when p_reorder is not null and p_qty <= p_reorder then 'attention'", replace: "when p_reorder is not null and p_qty < p_reorder then 'attention'" },
  // --- importação, anexos e exportação
  { name: 'importação: mesmo arquivo reimportado', file: 'inv_import', find: "if found then return jsonb_build_object('duplicate_file', true, 'import_id', ex.id, 'status', ex.status); end if;", replace: '' },
  { name: 'importação: saldo inicial duplicado passa na prévia', file: 'inv_import', find: "st := 'duplicate'; msg := 'saldo inicial já lançado para este produto neste depósito';", replace: 'null;' },
  { name: 'importação: operador importa parâmetros', file: 'inv_import', find: "if (mn is not null or rp is not null or tg is not null) and not mgr then raise exception 'operador não define parâmetros de reposição'; end if;", replace: '' },
  { name: 'importação: confirmar duas vezes', file: 'inv_import', find: "if j.status = 'completed' then return jsonb_build_object('already', true, 'accepted', j.accepted_rows); end if;", replace: '' },
  { name: 'importação: consulta importa produtos', file: 'inv_import', nth: 1, find: "when 'products' then 'operator'", replace: "when 'products' then 'read'" },
  { name: 'anexo: segunda imagem do produto aceita', file: 'inv_attachments', find: "if n >= (case when p_entity_type = 'product_image' then 1 else 20 end) then", replace: 'if n >= 20 then' },
  { name: 'exportação: operador exporta', file: 'inv_attachments', find: "perform private.inv_guard(p_org, 'manager');", replace: "perform private.inv_guard(p_org, 'operator');" },
  // --- métricas
  { name: 'métrica: valor por depósito sem maior resto', file: 'inv_metrics', find: '(r.base + case when r.q_total > 0 and r.rn <= r.k then 1 else 0 end)::bigint as value_cents,', replace: 'r.base::bigint as value_cents,' },
  { name: 'métrica: transferência vira entrada', file: 'inv_metrics', find: "count(distinct mp.operation_id) filter (where mp.movement_type = 'entry') eo", replace: "count(distinct mp.operation_id) filter (where mp.movement_type in ('entry', 'transfer_in')) eo" },
  { name: 'métrica: perda conta como saída operacional', file: 'inv_metrics', find: "from mv m where m.movement_type = 'issue' and m.reason_code in ('sale', 'internal_use')", replace: "from mv m where m.movement_type = 'issue'" },
  { name: 'métrica: cobertura sem janela mínima de dias', file: 'inv_metrics', find: "'coverage_products', (select count(*) from cover cv where cv.days_with >= 3 and cv.consumed > 0)", replace: "'coverage_products', (select count(*) from cover cv where cv.days_with >= 1 and cv.consumed > 0)" },
  { name: 'métrica: produto recém-cadastrado vira parado', file: 'inv_metrics', find: 'join public.products p on p.id = v.product_id and p.created_at < (today_ - p_days)::timestamp at time zone tz and p.archived_at is null', replace: 'join public.products p on p.id = v.product_id and p.archived_at is null' },
  // --- concorrência (suíte própria)
  { name: 'concorrência: estado de custo sem trava', file: 'inv_engine', suite: 'conc', find: 'perform 1 from public.inventory_cost_state c where c.organization_id = p_org and c.product_id = any (p_prod) order by c.product_id for update;', replace: 'perform 1;' },
  { name: 'concorrência: operação reversível sem trava', file: 'inv_engine', suite: 'conc', find: 'select * into o from public.stock_operations where id = p_operation for update;', replace: 'select * into o from public.stock_operations where id = p_operation;' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, 'scripts', SCRIPT[suite])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function workspace(label, mutate) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-inv-mut-${label}-`));
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) {
    const f = files.find((x) => x.includes(mutate.file));
    const path = join(dir, 'supabase', 'migrations', f);
    const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    const parts = text.split(mutate.find);
    const nth = mutate.nth ?? 1;
    if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
    if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
    if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
    writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
  }
  return dir;
}

const suitesNeeded = new Set(M.filter((m) => !only || m.name.includes(only)).map((m) => m.suite ?? 'db'));
for (const suite of suitesNeeded) {
  const base = workspace(`base-${suite}`, null);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const todo = M.filter((m) => !only || m.name.includes(only));
const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    let dir;
    try {
      dir = workspace(String(next), m);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, m.suite ?? 'db');
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
console.log(`\n${todo.length - survived.length - broken.length}/${todo.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
