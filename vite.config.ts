import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, 'VITE_');
  // Fail BEFORE bundling. Ignoring credential fields at runtime is not enough:
  // Vite would still inline the original JSON string into public JavaScript.
  if (Object.entries(env).some(([name, value]) => value && /^VITE_.*(?:SERVICE_ROLE|PRIVATE_KEY|DISPATCH_SECRET|TURN_(?:CREDENTIAL|USERNAME|TOKEN|API_KEY)|FCM_SERVER_KEY|APNS_KEY)/.test(name))) {
    throw new Error('Private server credentials must not be supplied as public VITE_* variables.');
  }
  if (env.VITE_ICE_SERVERS_JSON) {
    let valid = false;
    try {
      const servers = JSON.parse(env.VITE_ICE_SERVERS_JSON);
      valid = Array.isArray(servers) && servers.every((server) =>
        server && Object.keys(server).every((key) => key === 'urls') &&
        (Array.isArray(server.urls) ? server.urls : [server.urls]).every((url: unknown) =>
          typeof url === 'string' && /^stuns?:/.test(url)));
    } catch { /* Do not log the value or parser errors containing its secrets. */ }
    if (!valid) throw new Error('VITE_ICE_SERVERS_JSON must contain public STUN URLs only. TURN credentials must remain runtime-only.');
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('leaflet')) return 'map-vendor';
            if (id.includes('@zxing')) return 'zxing-vendor';
            if (id.includes('qrcode')) return 'qrcode-vendor';
            if (id.includes('@supabase')) return 'supabase-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
            if (id.includes('@google/genai')) return 'ai-vendor';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
            return 'vendor';
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow the Arena live-preview host (and any other host) to reach the dev server.
      allowedHosts: true,
    },
  };
});
