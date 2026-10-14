// Códigos de barras. Módulo puro (navegador e servidor). Espelha `private.inv_gtin_ok` do banco; o banco decide de verdade.
// Não se gera GTIN «oficial»: o sistema aceita códigos GS1 já existentes (EAN/UPC com dígito verificador) e cria CÓDIGOS INTERNOS (prefixo INT-).

export type BarcodeKind = 'EAN13' | 'EAN8' | 'UPCA' | 'CODE128';

export const BARCODE_PATTERN = /^[A-Za-z0-9._-]{3,48}$/;

/** true/false para numéricos de 8, 12 ou 13 dígitos (dígito verificador); null quando não é numérico (código interno). */
export function gtinOk(code: string): boolean | null {
  if (!/^[0-9]+$/.test(code)) return null;
  const n = code.length;
  if (n !== 8 && n !== 12 && n !== 13) return false;
  let s = 0;
  for (let i = 1; i < n; i++) s += Number(code[i - 1]) * ((n - i) % 2 === 1 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(code[n - 1]);
}

export type BarcodeCheck = { ok: true; kind: BarcodeKind } | { ok: false; message: string };

export function checkBarcode(raw: string): BarcodeCheck {
  const code = raw.trim();
  if (!BARCODE_PATTERN.test(code)) return { ok: false, message: 'Use de 3 a 48 caracteres: letras, números e . _ -' };
  const g = gtinOk(code);
  if (g === false) return { ok: false, message: 'Número inválido: use 8, 12 ou 13 dígitos com dígito verificador correto (EAN-8, UPC-A, EAN-13) ou um código interno com letras (ex.: INT-0001).' };
  if (g === true) return { ok: true, kind: code.length === 13 ? 'EAN13' : code.length === 8 ? 'EAN8' : 'UPCA' };
  return { ok: true, kind: 'CODE128' };
}

/** Código interno aleatório (não colide na prática; o banco garante a unicidade e a tela tenta de novo se necessário). */
export function internalCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = random(8);
  return 'INT-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
