import { defineConfig } from 'vite';

// Minimal config: keep the current single-file SPA shape.
// - No minification so the output stays diff-able against the source.
// - Flat asset layout (no /assets/ subdir, no content hashes) so
//   index.html's plain references (manifest.json) keep working.
// - Inline scripts in index.html are classic (no type="module"),
//   so Vite passes them through unchanged.
// Stamp the build time into index.html so the app can show which version is
// running (the source keeps the literal placeholder and displays "dev").
const buildStamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'pd-build-stamp',
    transformIndexHtml(html) {
      return html.replace('__PD_BUILD__', buildStamp);
    },
  }],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    cssMinify: false,
    assetsDir: '.',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
