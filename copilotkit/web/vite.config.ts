import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // 開発中も、/api は Go のゲートウェイ(../gateway)を通す。エージェントランタイムへは直接つながない。
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
})
