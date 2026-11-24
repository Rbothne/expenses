import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/expenses/",
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
