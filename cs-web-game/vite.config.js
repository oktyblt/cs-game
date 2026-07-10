import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: path.resolve(__dirname, 'public'),

  server: {
    port: 3000,
    headers: {
      // WebAssembly SharedArrayBuffer için ZORUNLU
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
      '/cs-assets': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
    fs: {
      // node_modules içindeki WASM dosyalarına erişim için
      allow: ['..'],
    },
  },

  optimizeDeps: {
    // Bu paketler pre-built WASM içeriyor, Vite transform etmemeli
    exclude: ['xash3d-fwgs', 'cs16-client', 'hlsdk-portable'],
  },

  build: {
    outDir:  path.resolve(__dirname, 'dist'),
    target:  'esnext',
    assetsInlineLimit: 0, // WASM dosyaları inline edilmesin
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/index.html'),
        oyna: path.resolve(__dirname, 'src/oyna/index.html'),
        sunucular: path.resolve(__dirname, 'src/sunucular/index.html'),
        sunucuKirala: path.resolve(__dirname, 'src/sunucu-kirala/index.html'),
        haritaDust2: path.resolve(__dirname, 'src/haritalar/de-dust2/index.html'),
      }
    }
  },

  // WASM dosyaları için MIME tipi
  plugins: [
    {
      name: 'wasm-content-type-plugin',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          }
          next();
        });
      },
    },
  ],
});
