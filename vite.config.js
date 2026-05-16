import { defineConfig } from 'vite';

// Minimal config: keep the current single-file SPA shape.
// - No minification so the output stays diff-able against the source.
// - Flat asset layout (no /assets/ subdir, no content hashes) so
//   index.html's plain references (manifest.json) keep working.
// - Inline scripts in index.html are classic (no type="module"),
//   so Vite passes them through unchanged.
export default defineConfig({
  base: './',
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
