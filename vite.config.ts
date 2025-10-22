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
        // After build, create standalone.html by inlining the bundle (if it exists)
        const distDir = resolve(__dirname, 'dist');
        const htmlPath = resolve(distDir, 'src', 'index.html');
        const jsPath = resolve(distDir, 'main.js');

        try {
          // Read the built HTML
          const html = readFileSync(htmlPath, 'utf-8');

          // Check if main.js exists and inline it if present
          let standaloneHtml = html;
          try {
            const js = readFileSync(jsPath, 'utf-8');
            standaloneHtml = html.replace(
              /<script[^>]*src="[^"]*main\.js"[^>]*><\/script>/g,
              `<script>\n${js}\n</script>`
            );
          } catch (e) {
            // main.js doesn't exist (static HTML entry point), that's okay
          }

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
