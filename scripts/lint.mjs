import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function main() {
  if (process.argv.length > 3) {
    console.error("Usage: node scripts/lint.mjs [openrpc-file]");
    return 1;
  }
  const document = process.argv[2] ?? fileURLToPath(new URL("../openrpc.json", import.meta.url));
  const linter = fileURLToPath(new URL("../node_modules/@open-rpc/openrpc-linter/bin/openrpc-linter.js", import.meta.url));
  const rules = fileURLToPath(new URL("../rules.yml", import.meta.url));
  const result = spawnSync(process.execPath, [linter, "lint", document, "-r", rules, "-f", "json"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    console.error("OpenRPC linter failed.");
    if (result.error) console.error(result.error.message);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return 1;
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("OpenRPC linter returned an invalid JSON report.");
    return 1;
  }
  if (report === null || (Array.isArray(report) && report.length === 0)) {
    console.log("OpenRPC lint: 0 errors, 0 warnings.");
    return 0;
  }
  console.error("OpenRPC lint requires an empty violation report:");
  console.error(JSON.stringify(report, null, 2));
  return 1;
}

process.exitCode = main();
