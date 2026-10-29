import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const path = (value: string) => fileURLToPath(new URL(value, import.meta.url))
const aliases = {
  '@deepseek-ai/dsh-client-ui-primitives': path('./src/vendor/dsh/primitives/index.ts'),
  '@deepseek-ai/dsh-client-ui-slots': path('./src/vendor/dsh/slots/index.ts'),
  '@deepseek-ai/dsh-client-store': path('./src/vendor/dsh/store/index.ts'),
  '@deepseek-ai/dsh-util-code-language': path('./src/vendor/dsh/utils/code-language/src/index.ts'),
  '@deepseek-ai/dsh-util-file-drag': path('./src/vendor/dsh/utils/file-drag/src/index.ts'),
  '@deepseek-ai/dsh-util-workspace-path': path('./src/vendor/dsh/utils/workspace-path/src/index.ts'),
  '@deepseek-ai/dsh-util-values': path('./src/vendor/dsh/utils/values/src/index.ts'),
  '@deepseek-ai/dsh-brand': path('./src/vendor/dsh/utils/brand/src/index.ts'),
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias: aliases, dedupe: ['react', 'react-dom'] },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development') },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4174', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:4174', ws: true },
    },
  },
})
