import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 前端请求 /api 会转发到后端 8787
      '/api': 'http://127.0.0.1:8787'
    }
  }
})
