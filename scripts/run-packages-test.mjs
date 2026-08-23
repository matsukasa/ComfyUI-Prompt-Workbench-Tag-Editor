import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const outfile = "dist/tests/packages.test.mjs";

await build({
  entryPoints: ["tests/packages.test.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["node:*"],
});

const child = spawn(process.execPath, ["--test", outfile], { stdio: "inherit" });
const code = await new Promise((resolve) => child.on("close", resolve));
await rm(outfile, { force: true });
process.exitCode = code ?? 1;
