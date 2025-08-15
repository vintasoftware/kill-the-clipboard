import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    target: "es2015",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    open: true,
    port: 3000,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "kill-the-clipboard": resolve(__dirname, "../dist/index.esm.js"),
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer"],
  },
});
