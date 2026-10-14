import { describe, expect, it } from 'vitest';
import { checkBarcode, gtinOk, internalCode } from '@/lib/inventory/barcode';
import { CsvError, decodeText, detectDelimiter, normalizeRows, parseCsv, safeCell, sha256Hex, suggestMapping, toCsv } from '@/lib/inventory/csv';
import { formatQty, formatUnitCost, lineValueCents, parseQty, parseUnitCostCents } from '@/lib/inventory/qty';

describe('parseQty (digitação brasileira, sem float)', () => {
  it('unidade inteira: ponto é milhar, vírgula e casas são recusadas', () => {
    expect(parseQty('1.234', 0)).toBe('1234');
    expect(parseQty('12', 0)).toBe('12');
    expect(parseQty('1,5', 0)).toBeNull();
    expect(parseQty('1.5', 0)).toBeNull();
  });
  it('unidade fracionária: vírgula é decimal; ponto único também; respeita as casas da unidade', () => {
    expect(parseQty('10,5', 3)).toBe('10.5');
    expect(parseQty('1.234,567', 3)).toBe('1234.567');
    expect(parseQty('1.234', 3)).toBe('1.234');
    expect(parseQty('1,2345', 3)).toBeNull();
  });
  it('recusa zero (salvo pedido), negativo, texto e acima do teto', () => {
    expect(parseQty('0', 3)).toBeNull();
    expect(parseQty('0', 3, { allowZero: true })).toBe('0');
    expect(parseQty('-1', 0)).toBeNull();
    expect(parseQty('1e3', 0)).toBeNull();
    expect(parseQty('abc', 0)).toBeNull();
    expect(parseQty('', 0)).toBeNull();
    expect(parseQty('1.000.000.000.000', 0)).toBeNull();
  });
  it('não perde precisão onde o float perderia', () => {
    expect(parseQty('0,3', 3)).toBe('0.3');
    expect(parseQty('999999999999,999', 3)).toBe('999999999999.999');
  });
});

describe('custo unitário e valor da linha', () => {
  it('reais → centavos como texto, até 4 casas de reais', () => {
    expect(parseUnitCostCents('12,34')).toBe('1234');
    expect(parseUnitCostCents('R$ 1.234,50')).toBe('123450');
    expect(parseUnitCostCents('0,0125')).toBe('1.25');
    expect(parseUnitCostCents('0,00001')).toBeNull();
    expect(parseUnitCostCents('-1')).toBeNull();
    expect(parseUnitCostCents('x')).toBeNull();
  });
  it('valor da linha em centavos inteiros, meio-para-o-par', () => {
    expect(lineValueCents('10', '2000')).toBe(20000);
    expect(lineValueCents('2.5', '1')).toBe(2); // 2,5 → 2 (par)
    expect(lineValueCents('3.5', '1')).toBe(4); // 3,5 → 4 (par)
    expect(lineValueCents('999999999999.999', '99999999999999')).toBeNull();
  });
  it('formatação pt-BR', () => {
    expect(formatQty('10.500')).toBe('10,5');
    expect(formatQty(null)).toBe('—');
    expect(formatUnitCost('1.25').replace(/\s/g, ' ')).toBe('R$ 0,0125');
  });
});

describe('códigos de barras', () => {
  it('valida o dígito verificador de EAN-13, EAN-8 e UPC-A', () => {
    expect(gtinOk('7891000100103')).toBe(true);
    expect(gtinOk('7891000100104')).toBe(false);
    expect(gtinOk('96385074')).toBe(true);
    expect(gtinOk('036000291452')).toBe(true);
    expect(gtinOk('123456789')).toBe(false); // numérico com tamanho inválido
    expect(gtinOk('INT-0001')).toBeNull();
  });
  it('classifica o tipo e recusa formato inválido', () => {
    expect(checkBarcode('7891000100103')).toEqual({ ok: true, kind: 'EAN13' });
    expect(checkBarcode('96385074')).toEqual({ ok: true, kind: 'EAN8' });
    expect(checkBarcode('INT-0001')).toEqual({ ok: true, kind: 'CODE128' });
    expect(checkBarcode('7891000100104').ok).toBe(false);
    expect(checkBarcode('a b').ok).toBe(false);
    expect(checkBarcode('<script>').ok).toBe(false);
    expect(checkBarcode('ab').ok).toBe(false);
  });
  it('código interno usa o prefixo INT- e alfabeto sem ambíguos', () => {
    const c = internalCode(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(c).toMatch(/^INT-[A-HJ-NP-Z2-9]{8}$/);
    expect(checkBarcode(c).ok).toBe(true);
  });
});

describe('CSV: leitura', () => {
  it('detecta o separador e lê aspas, aspas escapadas e quebra dentro do campo', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    const rows = parseCsv('a;b\r\n"x;y";"diz ""oi"""\r\n"linha1\nlinha2";z\r\n', ';');
    expect(rows).toEqual([['a', 'b'], ['x;y', 'diz "oi"'], ['linha1\nlinha2', 'z']]);
  });
  it('recusa aspas abertas, linhas demais e célula gigante', () => {
    expect(() => parseCsv('a;"b', ';')).toThrow(CsvError);
    expect(() => parseCsv(`${'x'.repeat(2001)};b`, ';')).toThrow(CsvError);
    expect(() => parseCsv(Array.from({ length: 5002 }, () => 'a').join('\n'), ';')).toThrow(CsvError);
  });
  it('decodifica UTF-8 (com BOM) e cai para Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ text: 'a', encoding: 'utf-8' });
    const w = decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(w).toEqual({ text: 'café', encoding: 'windows-1252' });
  });
  it('sha256 estável (impede reimportar o mesmo arquivo)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('CSV: mapeamento e linhas', () => {
  it('sugere colunas por apelidos, sem repetir coluna', () => {
    const m = suggestMapping('products', ['Código', 'Descrição', 'Un', 'EAN']);
    expect(m.sku).toBe(0);
    expect(m.unit).toBe(2);
    expect(m.barcode).toBe(3);
    const used = Object.values(m).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });
  it('normaliza produtos e marca erros por linha sem derrubar o arquivo', () => {
    const map = { sku: 0, name: 1, unit: 2, minimum: 3, type: 4 };
    const out = normalizeRows('products', [['A-1', 'Cabo', 'un', '2,5', 'Insumo'], ['A-2', 'Fita', 'un', 'abc', ''], ['A-3', 'X', 'un', '', 'xyz']], map);
    expect(out[0]).toMatchObject({ row_number: 2, parse_error: null, data: { sku: 'A-1', minimum: '2.5', type: 'supply' } });
    expect(out[1]!.parse_error).toMatch(/mínimo «abc»/);
    expect(out[2]!.parse_error).toMatch(/tipo «xyz» desconhecido/);
  });
  it('saldo inicial: custo em centavos e opção «sem custo»', () => {
    const map = { sku: 0, warehouse: 1, quantity: 2, unit_cost: 3, cost_mode: 4 };
    const [a, b] = normalizeRows('opening', [['A', 'LOJA', '10', '5,00', ''], ['B', 'CD', '2', '', 'sim']], map);
    expect(a!.data).toMatchObject({ quantity: '10', unit_cost: '500', cost_mode: 'informed' });
    expect(b!.data.cost_mode).toBe('none');
  });
  it('remove caracteres de controle', () => {
    const [r] = normalizeRows('categories', [['Ca\u0001bos']], { name: 0 });
    expect(r!.data.name).toBe('Cabos');
  });
});

describe('CSV: escrita segura', () => {
  it('neutraliza fórmulas em texto e preserva números formais', () => {
    expect(safeCell('=1+1')).toBe("'=1+1");
    expect(safeCell('+55')).toBe("'+55");
    expect(safeCell('-x')).toBe("'-x");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell({ num: '-12,50' })).toBe('"-12,50"'); // número formal: sem apóstrofo (só aspas por causa da vírgula)
    expect(safeCell({ num: '-12.5' })).toBe('-12.5');
    expect(safeCell(-3)).toBe('-3');
    expect(safeCell(null)).toBe('');
  });
  it('escapa separador, aspas e quebras; usa ; e BOM', () => {
    expect(safeCell('a;b')).toBe('"a;b"');
    expect(safeCell('diz "oi"')).toBe('"diz ""oi"""');
    const csv = toCsv(['A', 'B'], [['x', 1]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('﻿A;B\r\nx;1\r\n');
  });
});
