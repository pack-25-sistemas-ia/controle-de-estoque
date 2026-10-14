#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova: saídas paralelas nunca deixam o saldo negativo; a mesma chave não duplica; estorno simultâneo vale uma vez;
// transferências cruzadas não travam e conservam o total; operações de vários itens em ordens diferentes não geram impasse;
// aprovação simultânea de inventário vale uma vez; ao final o livro bate com saldos e custo.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-inv-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const OWNER = 'ffffffff-0000-4000-8000-0000000000a0';
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: depois de armGun(), toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina;
// assim as sessões entram no motor AO MESMO TEMPO, não uma depois da outra.
const GUN_KEY = 7777001;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, { asOwner = false } = {}) {
  const wrapped = asOwner
    ? `begin; select set_config('request.jwt.claims', '{"sub":"${OWNER}","aal":"aal2","email":"oa@t.invalid"}', true); set local role authenticated; ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit;`
    : sql;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(wrapped);
  });
}
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await psql("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, opts) => { const r = await psql(sql, opts); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const last = (r) => r.out.split('\n').filter(Boolean).pop();

let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).sort().map((x) => `migrations/${x}`)]) {
    const r = await psql(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  await psql(`insert into auth.users (id, email) values ('${OWNER}', 'oa@t.invalid')`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc')`, { asOwner: true });
  const unit = await one(`select id from public.units_of_measure where organization_id = '${org}' and symbol = 'un'`);
  const wh = (n, c) => one(`insert into public.warehouses (organization_id, name, code) values ('${org}', '${n}', '${c}') returning id`, { asOwner: true });
  const prod = (sku) => one(`insert into public.products (organization_id, unit_id, sku, name) values ('${org}', '${unit}', '${sku}', 'Produto ${sku}') returning id`, { asOwner: true });
  const W1 = await wh('Depósito 1', 'W1'), W2 = await wh('Depósito 2', 'W2');
  const [P1, P2, P3, P4] = [await prod('C1'), await prod('C2'), await prod('C3'), await prod('C4')];
  const items = (...xs) => `'${JSON.stringify(xs.map(([p, q, c]) => ({ product_id: p, quantity: q, ...(c ? { unit_cost: c } : {}) })))}'::jsonb`;
  const entry = (w, its, key) => psql(`select public.inv_post_entry('${org}', '${w}', 'purchase', ${its}, null, null, null, null, '${key}')`, { asOwner: true });
  const issue = (w, its, key) => psql(`select public.inv_post_issue('${org}', '${w}', 'sale', ${its}, null, null, null, '${key}')`, { asOwner: true });
  const transfer = (a, b, its, key) => psql(`select public.inv_post_transfer('${org}', '${a}', '${b}', ${its}, null, null, '${key}')`, { asOwner: true });
  const bal = async (p, w) => Number(await one(`select coalesce((select quantity_on_hand from public.inventory_balances where product_id = '${p}' and warehouse_id = '${w}'), 0)`));
  const cost = (p) => one(`select quantity_valued::text || '/' || total_value_cents::text from public.inventory_cost_state where product_id = '${p}'`);

  // 1) 12 saídas simultâneas de 5 sobre um saldo de 40: só 8 cabem, saldo termina em 0 e nunca fica negativo
  await entry(W1, items([P1, 40, 1000]), 'conc-seed-0001');
  const r1 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 12 }, (_, k) => issue(W1, items([P1, 5]), `conc-sale-${String(k).padStart(3, '0')}-xx`)));
  const ok1 = r1.filter((r) => r.code === 0).length;
  check(ok1 === 8 && (await bal(P1, W1)) === 0, `12 saídas de 5 sobre 40 un: exatamente 8 passam e o saldo termina em zero (passaram ${ok1}, saldo ${await bal(P1, W1)})`);
  check(r1.filter((r) => r.code !== 0).every((r) => /saldo insuficiente/.test(r.err)), 'as demais falham por «saldo insuficiente», sem outro erro');
  check((await cost(P1)) === '0.000/0', 'custo zerado junto com a quantidade (nenhum centavo sobra)');

  // 2) 8 requisições com a MESMA chave: uma operação só
  const r2 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 8 }, () => entry(W1, items([P2, 10, 2000]), 'conc-same-key-001')));
  const ids2 = new Set(r2.filter((r) => r.code === 0).map(last));
  check(r2.every((r) => r.code === 0) && ids2.size === 1, 'mesma chave em 8 requisições: todas ok e devolvem a mesma operação');
  check(Number(await one(`select count(*) from public.stock_movements where product_id = '${P2}'`)) === 1 && (await bal(P2, W1)) === 10, 'um único movimento e saldo 10');

  // 3) estorno simultâneo da mesma operação: vale uma vez
  const opId = [...ids2][0];
  const r3 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 6 }, (_, k) => psql(`select public.inv_reverse_operation('${opId}', 'estorno concorrente de teste', 'conc-rev-${String(k).padStart(3, '0')}-xx')`, { asOwner: true })));
  check(r3.filter((r) => r.code === 0).length === 1, `6 estornos simultâneos: só 1 vale (valeram ${r3.filter((r) => r.code === 0).length})`);
  check(r3.filter((r) => r.code !== 0).every((r) => /já estornada/.test(r.err)), 'os demais falham por «já estornada»');
  check((await bal(P2, W1)) === 0 && (await cost(P2)) === '0.000/0', 'saldo e custo de volta a zero, uma única vez');

  // 4) estorno de entrada × saída simultâneas: o saldo não cobre as duas coisas
  const e4 = last(await entry(W1, items([P3, 10, 500]), 'conc-e4-0001'));
  await (await armGun(), Promise.all.bind(Promise))([
    psql(`select public.inv_reverse_operation('${e4}', 'estorno concorrente com saída', 'conc-e4-rev-001')`, { asOwner: true }),
    ...Array.from({ length: 3 }, (_, k) => issue(W1, items([P3, 4]), `conc-e4-sale-${k}-xx`)),
  ]);
  const bal4 = await bal(P3, W1);
  check(bal4 >= 0, `estorno de entrada × saídas simultâneas: saldo nunca negativo (saldo ${bal4})`);
  check(Number(await one(`select count(*) from public.inv_reconcile('${org}')`, { asOwner: true })) === 0, 'reconciliação sem divergências depois da disputa');

  // 5) transferências cruzadas W1→W2 e W2→W1 simultâneas: sem impasse e com total conservado
  await entry(W1, items([P4, 100, 1000]), 'conc-seed-0004');
  await entry(W2, items([P4, 100, 1000]), 'conc-seed-0005');
  const r5 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 20 }, (_, k) => k % 2 === 0
    ? transfer(W1, W2, items([P4, 3]), `conc-xfer-ab-${String(k).padStart(3, '0')}`)
    : transfer(W2, W1, items([P4, 2]), `conc-xfer-ba-${String(k).padStart(3, '0')}`)));
  check(r5.every((r) => r.code === 0), '20 transferências cruzadas simultâneas concluem sem impasse');
  const b1 = await bal(P4, W1), b2 = await bal(P4, W2);
  check(b1 === 100 - 30 + 20 && b2 === 100 + 30 - 20 && b1 + b2 === 200, `saldos batem e o total é conservado (W1 ${b1}, W2 ${b2})`);
  check((await cost(P4)) === '200.000/200000', 'valor consolidado intacto após as transferências');

  // 6) operações de VÁRIOS itens em ordens diferentes (risco de impasse): sem erro de deadlock
  await entry(W1, items([P1, 500, 1000], [P2, 500, 1000], [P3, 500, 1000], [P4, 500, 1000]), 'conc-seed-0006');
  const orders = [[P1, P2, P3, P4], [P4, P3, P2, P1], [P2, P4, P1, P3], [P3, P1, P4, P2]];
  const r6 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 24 }, (_, k) => {
    const o = orders[k % 4];
    return k % 3 === 0 ? issue(W1, items(...o.map((p) => [p, 1])), `conc-multi-s-${String(k).padStart(3, '0')}`)
         : k % 3 === 1 ? entry(W1, items(...o.map((p) => [p, 2, 1100])), `conc-multi-e-${String(k).padStart(3, '0')}`)
         : transfer(W1, W2, items(...o.map((p) => [p, 1])), `conc-multi-t-${String(k).padStart(3, '0')}`);
  }));
  check(r6.every((r) => r.code === 0), '24 operações de 4 itens em ordens diferentes concluem sem impasse');
  check(!r6.some((r) => /deadlock/i.test(r.err)), 'nenhum deadlock reportado');

  // 6b) entradas simultâneas do MESMO produto em depósitos diferentes: o estado de custo (compartilhado) não perde atualização
  const P5 = await prod('C5');
  const r6b = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 10 }, (_, k) => entry(k % 2 ? W1 : W2, items([P5, 1, 1000]), `conc-cost-${String(k).padStart(3, '0')}-xxxx`)));
  check(r6b.every((r) => r.code === 0), '10 entradas simultâneas do mesmo produto em dois depósitos concluem');
  check((await cost(P5)) === '10.000/10000', `custo consolidado fecha exato: 10 un e R$ 100,00 (obtido ${await cost(P5)})`);

  // 7) inventário: 5 aprovações simultâneas valem uma vez
  const cnt = await one(`select public.inv_create_count('${org}', '${W2}', 'Contagem concorrente', '{${P4}}'::uuid[], null)`, { asOwner: true });
  const item = await one(`select id from public.physical_count_items where count_id = '${cnt}'`);
  await psql(`select public.inv_count_record('${item}', 1, 'contagem')`, { asOwner: true });
  await psql(`select public.inv_submit_count('${cnt}')`, { asOwner: true });
  const r7 = await (await armGun(), Promise.all.bind(Promise))(Array.from({ length: 5 }, () => psql(`select public.inv_approve_count('${cnt}')`, { asOwner: true })));
  check(r7.filter((r) => r.code === 0).length === 1, `5 aprovações simultâneas: só 1 vale (valeram ${r7.filter((r) => r.code === 0).length})`);
  check(Number(await one(`select count(*) from public.stock_operations where count_id = '${cnt}'`)) === 1, 'uma única operação de ajuste do inventário');

  // 8) invariantes finais
  check(Number(await one(`select count(*) from public.inv_reconcile('${org}')`, { asOwner: true })) === 0, 'saldo = soma do livro, quantidade do custo = soma dos saldos, valor do custo = soma dos valores');
  check(Number(await one(`select count(*) from public.inventory_balances where quantity_on_hand < 0`)) === 0, 'nenhum saldo negativo');
  check(Number(await one(`select coalesce(sum(m.quantity_delta), 0) from public.stock_movements m join public.stock_operations o on o.id = m.operation_id where o.operation_type = 'transfer'`)) === 0, 'transferências somam zero no livro');
  check(Number(await one(`select count(*) from (select operation_id, item_id from public.stock_movements group by 1, 2 having count(*) > 2) x`)) === 0, 'nenhum item com mais de dois movimentos');
} catch (e) {
  console.error(String(e.message ?? e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed === 0 ? 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM' : `CONCORRÊNCIA: ${failed} FALHA(S)`);
process.exit(failed === 0 ? 0 : 1);
