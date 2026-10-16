import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  // Gateway requires a paid plan. Set true after upgrading, then neon deploy.
  aiGateway: false,
  functions: {
    workload: { name: "Team workload summary", source: "./src/functions/workload.ts", env: { WORKLOAD_SECRET: process.env.WORKLOAD_SECRET! } },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
