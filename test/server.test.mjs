import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import coverageModule from "@open-rpc/test-coverage";
import examplesModule from "@open-rpc/test-coverage/build/rules/examples-rule.js";
import Ajv from "ajv";
import spec from "../openrpc.json" with { type: "json" };
import { createSearchServer } from "../server.mjs";

const method = spec.methods.find(({ name }) => name === "searchInventory");
const ajv = new Ajv({ strict: false });
const validateResult = ajv.compile({ ...method.result.schema, components: spec.components });
const server = createSearchServer();
let url;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

async function send(body, options = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
    ...options,
  });
}

async function post(payload) {
  const response = await send(JSON.stringify(payload));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  return response.json();
}

function assertResult(result) {
  assert.equal(validateResult(result), true, ajv.errorsText(validateResult.errors));
}

async function rpc(params, id = 1) {
  const body = await post({ jsonrpc: "2.0", id, method: "searchInventory", params });
  assert.deepEqual(Object.keys(body).sort(), ["id", "jsonrpc", "result"]);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  assertResult(body.result);
  return body.result;
}

async function assertSearchError(params, code) {
  const error = method.errors.find((entry) => entry.code === code);
  assert.ok(error);
  const body = await post({ jsonrpc: "2.0", id: "search-error", method: method.name, params });
  assert.deepEqual(body, {
    jsonrpc: "2.0", id: "search-error", error: { code: error.code, message: error.message },
  });
}

for (const [vehicleType, expected] of [
  ["sedan", ["veh-1001", "veh-1002"]],
  ["truck", ["veh-2001", "veh-2002"]],
  ["van", ["veh-3001", "veh-3002"]],
]) {
  test(`HTTP search returns only ${vehicleType} listings`, async () => {
    const results = await rpc({ zipCode: "78701", vehicleType });
    assert.deepEqual(results.map(({ id }) => id), expected);
    assert.ok(results.every((listing) => listing.vehicleType === vehicleType));
  });
}

test("HTTP search without vehicleType includes all types and retains existing filters", async () => {
  for (const [filters, expected] of [
    [{}, ["veh-1001", "veh-2001", "veh-2002", "veh-1002", "veh-3001", "veh-3002"]],
    [{ make: "Ford" }, ["veh-2001", "veh-3001", "veh-3002"]],
    [{ model: "Camry" }, ["veh-1001", "veh-1002"]],
    [{ maxPrice: 34999 }, ["veh-1001", "veh-1002", "veh-3001"]],
  ]) {
    const result = await rpc({ zipCode: "78701", ...filters });
    assert.deepEqual(result.map(({ id }) => id), expected);
  }
});

test("HTTP search combines type, make, model, and inclusive price", async () => {
  const result = await rpc({
    zipCode: "78701", vehicleType: "van", make: "Ford", model: "Transit", maxPrice: 34999,
  });
  assert.deepEqual(result.map(({ id }) => id), ["veh-3001"]);
  for (const filters of [
    { vehicleType: "van", make: "Toyota" },
    { vehicleType: "truck", model: "Transit" },
    { vehicleType: "van", maxPrice: 34998 },
    { make: "Ford", model: "Camry" },
    { maxPrice: 0 },
  ]) {
    await assertSearchError({ zipCode: "78701", ...filters }, -32001);
  }
});

test("HTTP invalid vehicle values return the documented error, not empty inventory", async () => {
  for (const vehicleType of ["suv", "Sedan", "TRUCK", " van", "", null, 1, true, [], {}]) {
    await assertSearchError({ zipCode: "78701", vehicleType, make: "Missing" }, -32602);
  }
});

test("HTTP validates required ZIP, existing parameter types, and parameter containers", async () => {
  for (const params of [
    undefined, [], {},
    { zipCode: 78701 }, { zipCode: "7870" }, { zipCode: "78701-123" },
    { zipCode: "78701", make: null }, { zipCode: "78701", model: 1 },
    { zipCode: "78701", maxPrice: -1 }, { zipCode: "78701", maxPrice: "35000" },
    { zipCode: "78701", vehicle_type: "truck" },
  ]) {
    await assertSearchError(params, -32602);
  }
});

test("HTTP positional parameters retain their indexes with and without vehicleType", async () => {
  assert.deepEqual(
    (await rpc(["Toyota", "Camry", 35000, "78701"])).map(({ id }) => id),
    ["veh-1001", "veh-1002"],
  );
  assert.deepEqual(
    (await rpc(["Ford", "Transit", 35000, "75201", "van"])).map(({ id }) => id),
    ["veh-3001"],
  );
  await assertSearchError(["Ford", "Transit", 35000, "75201", "suv"], -32602);
  await assertSearchError(["Ford", "Transit", 35000, "75201", "van", "extra"], -32602);
});

test("HTTP ranking respects fixture ZIPs, ZIP+4, price ties, and unknown distances", async () => {
  for (const [zipCode, expected] of [
    ["78701", ["veh-3001", "veh-3002"]],
    ["78701-1234", ["veh-3001", "veh-3002"]],
    ["75201", ["veh-3002", "veh-3001"]],
    ["10001", ["veh-3001", "veh-3002"]],
  ]) {
    assert.deepEqual((await rpc({ zipCode, vehicleType: "van" })).map(({ id }) => id), expected);
  }
});

class NamedExamplesRule extends examplesModule.default {
  getCalls(document, searchMethod) {
    return super.getCalls(document, searchMethod).map((call, index) => ({
      ...call,
      // The upstream rule ignores names when examples omit earlier optional parameters.
      params: Object.fromEntries(searchMethod.examples[index].params.map(({ name, value }) => [name, value])),
    }));
  }
}

test("OpenRPC coverage executes all search examples over HTTP with strict result assertions", async (t) => {
  const calls = await coverageModule.default({
    openrpcDocument: { ...spec, servers: [{ name: "Test server", url }] },
    transport: "http",
    // The console reporter exits the process and would skip the remaining assertions.
    reporters: ["empty"],
    only: ["searchInventory"],
    rules: [new NamedExamplesRule()],
  });
  assert.equal(calls.length, method.examples.length);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.methodName, "searchInventory");
    assert.equal(call.valid, true, call.reason);
    assert.equal(call.requestError, undefined);
    assert.equal(call.error, undefined);
    assert.deepEqual(call.result, method.examples[index].result.value);
    assertResult(call.result);
  }
  t.diagnostic(`OpenRPC examples: ${calls.length}/${method.examples.length}; runtime methods: 1/${spec.methods.length}. Other methods are not implemented or covered.`);
});

test("the response schema rejects missing required fields and invalid classifications", async () => {
  const [listing] = await rpc({ zipCode: "78701", vehicleType: "sedan" });
  const { make, ...missingMake } = listing;
  assert.equal(validateResult([missingMake]), false);
  assert.equal(validateResult([{ ...listing, vehicleType: "suv" }]), false);
  assert.equal(validateResult([{ ...listing, price: -1 }]), false);
});

test("JSON-RPC echoes string, numeric, zero, empty-string, and null request IDs", async () => {
  for (const id of ["request-1", 12, 0, "", null, 1.5]) {
    await rpc({ zipCode: "78701", vehicleType: "truck" }, id);
  }
});

test("malformed JSON and invalid UTF-8 produce Parse error with null ID", async () => {
  for (const body of ["", "{", '{"jsonrpc":"2.0",}', Buffer.from([0x22, 0xff, 0x22])]) {
    const response = await send(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" },
    });
  }
});

test("invalid request objects, versions, methods, and IDs produce Invalid Request", async () => {
  for (const payload of [
    null, true, 1, "searchInventory", {},
    { jsonrpc: "1.0", id: 1, method: "searchInventory" },
    { jsonrpc: "2.0", id: 1, method: 1 },
    ...[null, "78701", true, 1].map((params) => ({ jsonrpc: "2.0", id: 1, method: "searchInventory", params })),
    { jsonrpc: "2.0", method: "searchInventory", params: null },
    ...[true, {}, []].map((id) => ({ jsonrpc: "2.0", id, method: "searchInventory" })),
  ]) {
    assert.deepEqual(await post(payload), {
      jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" },
    });
  }
});

test("unsupported illustrative and reserved methods return Method not found", async () => {
  for (const name of [...spec.methods.filter(({ name }) => name !== method.name).map(({ name }) => name),
    "rpc.discover", "toString", "missing"]) {
    assert.deepEqual(await post({ jsonrpc: "2.0", id: 7, method: name, params: {} }), {
      jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" },
    });
  }
});

test("notifications receive no JSON-RPC response, including method and parameter errors", async () => {
  for (const payload of [
    { jsonrpc: "2.0", method: "searchInventory", params: { zipCode: "78701" } },
    { jsonrpc: "2.0", method: "searchInventory", params: { zipCode: "78701", vehicleType: "suv" } },
    { jsonrpc: "2.0", method: "searchInventory", params: { zipCode: "78701", maxPrice: 0 } },
    { jsonrpc: "2.0", method: "missing" },
  ]) {
    const response = await send(JSON.stringify(payload));
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  }
});

test("mixed batches return call and invalid-request replies but omit notifications", async () => {
  const response = await post([
    { jsonrpc: "2.0", id: "trucks", method: "searchInventory", params: { zipCode: "78701", vehicleType: "truck" } },
    { jsonrpc: "2.0", method: "searchInventory", params: { zipCode: "78701" } },
    { jsonrpc: "2.0", id: "bad", method: "searchInventory", params: { zipCode: "78701", vehicleType: "suv" } },
    1,
    [],
  ]);
  assert.equal(response.length, 4);
  assert.deepEqual(Object.keys(response[0]).sort(), ["id", "jsonrpc", "result"]);
  assert.equal(response[0].jsonrpc, "2.0");
  assert.equal(response[0].id, "trucks");
  assertResult(response[0].result);
  assert.deepEqual(response[0].result.map(({ id }) => id), ["veh-2001", "veh-2002"]);
  assert.deepEqual(response.slice(1), [
    { jsonrpc: "2.0", id: "bad", error: { code: -32602, message: "Invalid params" } },
    { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
  ]);
});

test("empty batches fail, while notification-only batches have no response", async () => {
  assert.deepEqual(await post([]), {
    jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" },
  });
  const response = await send(JSON.stringify([
    { jsonrpc: "2.0", method: "searchInventory", params: { zipCode: "78701" } },
    { jsonrpc: "2.0", method: "missing" },
  ]));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("HTTP rejects wrong routes, verbs, and content types", async () => {
  const wrongRoute = await fetch(`${url}/missing`, { signal: AbortSignal.timeout(5000) });
  assert.equal(wrongRoute.status, 404);
  const wrongVerb = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(wrongVerb.status, 405);
  assert.equal(wrongVerb.headers.get("allow"), "POST");
  for (const headers of [{}, { "Content-Type": "text/plain" }]) {
    const response = await send("{}", { headers });
    assert.equal(response.status, 415);
  }
  const response = await send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "searchInventory", params: { zipCode: "78701" } }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } });
  assert.equal(response.status, 200);
  assertResult((await response.json()).result);
});

test("HTTP bounds request bodies without preventing subsequent searches", async () => {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "searchInventory", params: { zipCode: "78701" } });
  const response = await send(payload.padEnd(64 * 1024, " "));
  assert.equal(response.status, 200);
  assertResult((await response.json()).result);
  const oversized = await send(payload.padEnd(64 * 1024 + 1, " "));
  assert.equal(oversized.status, 413);
  assert.equal(await oversized.text(), "");
  await rpc({ zipCode: "78701", vehicleType: "van" });
});

test("the CLI starts a real loopback server and rejects invalid ports", { timeout: 10000 }, async (t) => {
  const cwd = new URL("..", import.meta.url);
  const child = spawn(process.execPath, ["start.mjs"], {
    cwd, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  });
  const [output] = await once(child.stdout, "data");
  const match = output.toString().match(/listening at (http:\/\/127\.0\.0\.1:\d+)/);
  assert.ok(match);
  const response = await fetch(match[1], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "searchInventory", params: { zipCode: "78701", vehicleType: "sedan" } }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 1);
  assertResult(body.result);
  assert.deepEqual(body.result.map(({ id }) => id), ["veh-1001", "veh-1002"]);
  const invalidPort = spawnSync(process.execPath, ["start.mjs"], {
    cwd, env: { ...process.env, PORT: "65536" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(invalidPort.status, 1);
  assert.match(invalidPort.stderr, /PORT must be an integer/);
});
