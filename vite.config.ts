import { defineConfig } from 'vite';

// On GitHub Pages the app is served from https://<user>.github.io/<repo>/,
// so the base path must be "/<repo>/". The deploy workflow passes the repo
// name in BASE_PATH; locally we serve from "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  // Shown on the setup screen so you can tell which deploy the phone is running.
  define: { __BUILD__: JSON.stringify(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`) },
  build: { target: 'es2020' },
});
