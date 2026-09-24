import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@app/sdk": fileURLToPath(new URL("./stubs/app-sdk/index.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/config/**", "src/data/metrics/**"],
      exclude: ["src/**/__tests__/**", "src/data/metrics/types.ts", "src/data/metrics/query/specs.ts", "src/data/metrics/source/MetricsSource.ts"],
      reporter: ["text-summary", "text", "json-summary"],
    },
  },
});
