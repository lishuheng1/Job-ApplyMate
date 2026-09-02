import { defineConfig } from 'vite';
import { resolve } from 'path';

// Chrome 的 manifest content_scripts 按普通脚本执行，不能含 ESM import。
// 单独构建为自包含 IIFE，避免 Rollup 把共享代码拆成外部 chunk。
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'JobApplyMateContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
