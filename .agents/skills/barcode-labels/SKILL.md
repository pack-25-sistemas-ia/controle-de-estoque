---
name: barcode-labels
description: Use ao validar, gerar, ler ou imprimir códigos de barras e etiquetas de produto, e ao tratar leitura por teclado, leitor USB ou câmera.
---

# Códigos de barras e etiquetas

- Aceita GS1 já existente (EAN-13, EAN-8, UPC-A com dígito verificador correto, `gtinOk`) ou **código interno** com prefixo `INT-` (CODE 128). **Não gera GTIN «oficial»**. Espelho no banco: `private.inv_gtin_ok`; o banco decide.
- Padrão geral: 3–48 caracteres `[A-Za-z0-9._-]`; único por empresa.
- Leitura: campo com foco + Enter (leitor USB) é o caminho principal; câmera é opcional (`BarcodeDetector`, ZXing sob demanda), só depois de um clique; nunca pré-requisito.
- Etiqueta: JsBarcode desenha em **canvas** (CSP não aceita estilo de SVG), impressão por CSS `print:`; o canvas tem `role="img"` e nome «Código de barras …».
- Imagem de produto: `/api/attachments/ID?inline=1` (assinada, curta), porque `img-src` é só `'self'`.
- Testes: `tests/unit/inventory-qty-barcode-csv.test.ts`, E2E `inv-flow` (cadastro e etiqueta).
