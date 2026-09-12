import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const pluginId = process.argv[2];
if (!/^[a-z][a-z0-9_]{1,31}$/u.test(pluginId ?? ""))
  throw new Error("Provide a valid plugin ID.");
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(repositoryRoot, pluginId);
await build({
  root,
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    target: "es2022",
    emptyOutDir: false,
    outDir: "dist/frontend",
    lib: {
      entry: resolve(root, "frontend/entry.tsx"),
      formats: ["es"],
      fileName: () => "entry.js",
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".css"))
            ? "styles.css"
            : "[name][extname]",
      },
    },
  },
});
