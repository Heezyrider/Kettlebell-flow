import { defineConfig } from 'vite';

// On GitHub Pages the app is served from https://<user>.github.io/<repo>/,
// so the base path must be "/<repo>/". The deploy workflow passes the repo
// name in BASE_PATH; locally we serve from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2020' },
});
