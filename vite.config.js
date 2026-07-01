import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Electron loads the production page through file://, so assets must be relative.
  base: "./"
});
