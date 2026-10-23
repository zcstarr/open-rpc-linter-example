import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import spec from "../openrpc.json" with { type: "json" };

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "inventory-lint-"));
let nextFixture = 0;
after(() => rmSync(directory, { recursive: true, force: true }));

function fixture(document) {
  const file = join(directory, `${nextFixture++}.json`);
  writeFileSync(file, JSON.stringify(document));
  return file;
}

function lint(file) {
  return spawnSync(process.execPath, ["scripts/lint.mjs", ...(file ? [file] : [])], {
    cwd: root, encoding: "utf8", timeout: 10000,
  });
}

function extraParameter(name) {
  return {
    name,
    description: "Additional filter.",
    schema: { title: "Additional filter", description: "Additional filter value.", type: "string" },
  };
}

test("the published contract passes lint with zero warnings", () => {
  const result = lint();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 errors, 0 warnings/);
});

test("searchInventory cannot exceed its five-parameter exception", () => {
  const document = structuredClone(spec);
  document.methods.find(({ name }) => name === "searchInventory").params.push(extraParameter("extra"));
  const result = lint(fixture(document));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /search-inventory-param-count-limit/);
  assert.match(result.stderr, /"severity": "warn"/);
});

test("other methods still allow four parameters but reject a fifth", () => {
  const document = structuredClone(spec);
  const method = document.methods.find(({ name }) => name === "getVehicleDetails");
  method.params.push(...["second", "third", "fourth"].map(extraParameter));
  const allowed = lint(fixture(document));
  assert.equal(allowed.status, 0, allowed.stderr);
  method.params.push(extraParameter("fifth"));
  const rejected = lint(fixture(document));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /"ruleId": "param-count-limit"/);
  assert.doesNotMatch(rejected.stderr, /search-inventory-param-count-limit/);
});

test("the count exception requires the exact searchInventory method name", () => {
  const document = structuredClone(spec);
  document.methods.find(({ name }) => name === "searchInventory").name = "searchInventoryV2";
  const result = lint(fixture(document));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"ruleId": "param-count-limit"/);
});

test("warnings fail the guard even when the pinned linter exits successfully", () => {
  const document = structuredClone(spec);
  delete document.info.license;
  const file = fixture(document);
  const raw = spawnSync(process.execPath, [
    "node_modules/@open-rpc/openrpc-linter/bin/openrpc-linter.js",
    "lint", file, "-r", "rules.yml", "-f", "json",
  ], { cwd: root, encoding: "utf8", timeout: 10000 });
  assert.equal(raw.status, 0, raw.stderr);
  assert.ok(JSON.parse(raw.stdout).some(({ ruleId }) => ruleId === "info-license"));
  const guarded = lint(file);
  assert.equal(guarded.status, 1);
  assert.match(guarded.stderr, /info-license/);
});

test("remaining recommended schema rules still reject missing documentation", () => {
  const document = structuredClone(spec);
  delete document.methods[0].params[0].schema.title;
  const result = lint(fixture(document));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /schema-title/);
});

test("invalid JSON and missing documents fail instead of being treated as clean reports", () => {
  const invalid = join(directory, "invalid.json");
  writeFileSync(invalid, "{");
  for (const file of [invalid, join(directory, "missing.json")]) {
    const result = lint(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /OpenRPC linter failed/);
  }
});
