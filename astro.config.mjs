// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://packet-lab.vercel.app',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});