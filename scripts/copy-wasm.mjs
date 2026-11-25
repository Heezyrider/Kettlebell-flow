// Copies the MediaPipe WASM runtime into public/ so it is served from our own
// origin (works offline once cached, no third-party CDN needed at runtime).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = resolve(root, 'public/mediapipe-wasm');
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('Copied MediaPipe WASM runtime to public/mediapipe-wasm');
