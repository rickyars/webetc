import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'ES2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src', 'index.html'),
      },
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: '[name].js',
      },
    },
  },
  plugins: [
    {
      name: 'standalone-bundle',
      apply: 'build',
      writeBundle() {
        // After build, create standalone.html by inlining the bundle
        const distDir = resolve(__dirname, 'dist');
        const htmlPath = resolve(distDir, 'src', 'index.html');
        const jsPath = resolve(distDir, 'main.js');

        try {
          // Read the built HTML and JS
          const html = readFileSync(htmlPath, 'utf-8');
          const js = readFileSync(jsPath, 'utf-8');

          // Inline JS into HTML (remove script tag and inject inline)
          const standaloneHtml = html.replace(
            /<script[^>]*src="[^"]*main\.js"[^>]*><\/script>/g,
            `<script>\n${js}\n</script>`
          );

          // Write standalone.html to root
          writeFileSync(resolve(__dirname, 'standalone.html'), standaloneHtml);
          console.log('✓ Generated standalone.html');
        } catch (error) {
          console.error('Failed to generate standalone.html:', error);
        }
      },
    },
  ],
});
