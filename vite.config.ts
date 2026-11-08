import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { LOCAL_DEV_ORIGIN, localDevMessage } from './src/shared/local-dev.ts';

export default defineConfig(({ command, mode }) => {
  const live = command === 'serve' && mode === 'live';
  const target = live
    ? 'https://family-holiday-special-dev.juelzlax.workers.dev'
    : 'https://localhost:8787';
  const secret = live ? readFileSync('.wrangler/dev-operator-secret', 'utf8').trim() : '';
  if (live && secret.length < 32) throw new Error('The local dev operator credential is missing.');
  const guard: Plugin = {
    name: 'holiday-loopback-access',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origin = req.headers.origin;
        const host = req.headers.host ?? req.headers[':authority'];
        const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET');
        if (
          host !== new URL(LOCAL_DEV_ORIGIN).host ||
          (origin && origin !== LOCAL_DEV_ORIGIN) ||
          (mutation && origin !== LOCAL_DEV_ORIGIN)
        ) {
          res.writeHead(403).end('Use the local app origin.');
          return;
        }
        next();
      });
    },
  };
  const proxy: ProxyOptions = {
    target,
    secure: live,
    changeOrigin: live,
    proxyTimeout: 300000,
    ...(live && {
      configure(proxy) {
        proxy.on('proxyReq', (outgoing, req) => {
          const time = String(Math.floor(Date.now() / 1000));
          const url = new URL(req.url ?? '/', LOCAL_DEV_ORIGIN);
          outgoing.setHeader('Origin', target);
          outgoing.setHeader('X-Dev-Local-Time', time);
          outgoing.setHeader(
            'X-Dev-Local-Signature',
            createHmac('sha256', secret)
              .update(localDevMessage(req.method ?? 'GET', url.pathname + url.search, time))
              .digest('hex'),
          );
        });
      },
    }),
  };
  return {
    plugins: [react(), ...(live ? [basicSsl({ certDir: '.wrangler/local-https' }), guard] : [])],
    server: {
      host: 'localhost',
      port: live ? 8787 : 5173,
      strictPort: true,
      cors: false,
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.wrangler/**'] },
      proxy: { '^/api/': proxy, '^/s/': proxy },
    },
    build: { sourcemap: true, target: 'es2022' },
  };
});
