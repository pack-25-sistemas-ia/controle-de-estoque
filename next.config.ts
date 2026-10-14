import type { NextConfig } from 'next';

// Cabeçalhos estáticos. A CSP com nonce é gerada por requisição em proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Importação de planilhas (até 5 MB) e imagens de produtos (até 5 MB) passam por Server Actions/rotas: eleva os limites padrão. A câmera é liberada só para o próprio domínio (leitura de código de barras, sempre por ação do usuário).
  experimental: { proxyClientMaxBodySize: '12mb', serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
