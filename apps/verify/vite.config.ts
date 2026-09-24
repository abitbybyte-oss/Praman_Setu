import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** One self-contained verify.html with no external requests, so a verifier can
 * open it from a USB stick with no network (ARCHITECTURE §11). */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./verify.html", import.meta.url)),
    },
  },
});
