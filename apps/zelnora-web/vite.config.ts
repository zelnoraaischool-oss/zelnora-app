import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: "es2020", sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
});
