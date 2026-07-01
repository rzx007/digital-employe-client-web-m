import { defineConfig } from "tsup"

export default defineConfig({
  entry: { cli: "src/cli.ts", daemon: "src/daemon-entry.ts" },
  format: ["esm"],
  target: "node20",
  noExternal: [/@workspace\//],
  external: ["chrome-launcher", "chrome-remote-interface"],
  banner: { js: "#!/usr/bin/env node" },
  define: { __CLI_BUNDLE__: "true" },
  clean: true,
})
