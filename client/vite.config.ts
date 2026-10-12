import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// The ASP.NET Core tile server (server/Tilorama.Server).
const backend = 'http://localhost:5080'

// Single source for the version shown in the header and compared with the GitHub releases: client/package.json.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    // CHANGELOG.md in the repository root is built into the app.
    fs: { allow: ['..'] },
    proxy: {
      '/api': backend,
      '/tiles': backend,
    },
  },
  build: {
    // Served by the backend in production: `dotnet run` then hosts app + API + tiles on one port.
    outDir: '../server/Tilorama.Server/wwwroot',
    emptyOutDir: true,
    // OpenSeadragon alone is ~400 kB; irrelevant for an app served from localhost.
    chunkSizeWarningLimit: 900,
  },
})
