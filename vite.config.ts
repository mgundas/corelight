import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5183,
  },
  build: {
    target: 'es2022',
  },
});
