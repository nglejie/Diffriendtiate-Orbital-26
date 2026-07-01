import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit and component tests render React components, so they need jsdom plus
    // Testing Library matchers and browser API shims from the setup file.
    environment: "jsdom",
    globals: true,
    reporters: "default",
    setupFiles: [new URL("./setup/jsdom.setup.ts", import.meta.url).pathname],
    testTimeout: 20_000,
  },
});
