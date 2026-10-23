import assert from "node:assert/strict";
import test from "node:test";
import spec from "../openrpc.json" with { type: "json" };
import { searchInventory } from "../search-inventory.mjs";

const searchMethod = spec.methods.find(({ name }) => name === "searchInventory");
const ids = (params) => searchInventory(params).map(({ id }) => id);
const invalidParams = { code: -32602, message: "Invalid params" };
const noInventory = { code: -32001, message: "No inventory found for the given filters" };

for (const [vehicleType, expected] of [
  ["sedan", ["veh-1001", "veh-1002"]],
  ["truck", ["veh-2001", "veh-2002"]],
  ["van", ["veh-3001", "veh-3002"]],
]) {
  test(`returns only ${vehicleType} listings`, () => {
    const results = searchInventory({ zipCode: "78701", vehicleType });
    assert.deepEqual(results.map(({ id }) => id), expected);
    assert.ok(results.every((listing) => listing.vehicleType === vehicleType));
  });
}

test("omitting vehicleType includes every type in distance-then-price order", () => {
  assert.deepEqual(ids({ zipCode: "78701" }), [
    "veh-1001", "veh-2001", "veh-2002", "veh-1002", "veh-3001", "veh-3002",
  ]);
});

test("make, model, and inclusive maximum price work without vehicleType", () => {
  for (const [filters, expected] of [
    [{ make: "Ford" }, ["veh-2001", "veh-3001", "veh-3002"]],
    [{ model: "Camry" }, ["veh-1001", "veh-1002"]],
    [{ maxPrice: 34999 }, ["veh-1001", "veh-1002", "veh-3001"]],
    [{ make: "Toyota", model: "Camry", maxPrice: 30000 }, ["veh-1001"]],
  ]) {
    assert.deepEqual(ids({ zipCode: "78701", ...filters }), expected);
  }
});

test("vehicleType composes with make, model, and inclusive maximum price", () => {
  assert.deepEqual(ids({
    make: "Ford",
    model: "Transit",
    maxPrice: 34999,
    zipCode: "78701",
    vehicleType: "van",
  }), ["veh-3001"]);

  for (const filters of [
    { vehicleType: "van", make: "Toyota" },
    { vehicleType: "truck", model: "Transit" },
    { vehicleType: "van", maxPrice: 34998 },
    { make: "Ford", model: "Camry" },
    { maxPrice: 0 },
  ]) {
    assert.throws(() => searchInventory({ zipCode: "78701", ...filters }), noInventory);
  }
});

test("invalid vehicle types return Invalid params before searching", () => {
  for (const vehicleType of ["suv", "Sedan", "TRUCK", " van", "", null, 1, true, [], {}]) {
    assert.throws(
      () => searchInventory({ zipCode: "78701", make: "Missing", vehicleType }),
      invalidParams,
      `vehicleType: ${JSON.stringify(vehicleType)}`,
    );
  }
});

test("ZIP is required and must be a five-digit string or ZIP+4", () => {
  for (const zipCode of [undefined, null, 78701, "", "7870", "787010", "abcde", "78701-123", "78701\n"]) {
    assert.throws(() => searchInventory({ zipCode }), invalidParams);
  }
  assert.deepEqual(
    ids({ zipCode: "78701-1234", vehicleType: "truck" }),
    ids({ zipCode: "78701", vehicleType: "truck" }),
  );
});

test("fixture ZIP changes distance ranking, and equal distances use price", () => {
  assert.deepEqual(ids({ zipCode: "75201" }), [
    "veh-3002", "veh-3001", "veh-2002", "veh-1002", "veh-1001", "veh-2001",
  ]);
  assert.deepEqual(ids({ zipCode: "78701", vehicleType: "van" }), ["veh-3001", "veh-3002"]);
  assert.deepEqual(ids({ zipCode: "75201", vehicleType: "van" }), ["veh-3002", "veh-3001"]);
});

test("valid ZIPs without fixture distances retain matches sorted by price", () => {
  assert.deepEqual(ids({ zipCode: "10001" }), [
    "veh-1001", "veh-1002", "veh-3001", "veh-2002", "veh-3002", "veh-2001",
  ]);
});

test("positional callers keep the original indexes and can append vehicleType", () => {
  assert.deepEqual(
    searchInventory(["Toyota", "Camry", 35000, "78701"]),
    searchInventory({ make: "Toyota", model: "Camry", maxPrice: 35000, zipCode: "78701" }),
  );
  assert.deepEqual(
    ids(["Ford", "Transit", 35000, "75201", "van"]),
    ["veh-3001"],
  );
  assert.throws(() => searchInventory(["Ford", "Transit", 35000, "75201", "suv"]), invalidParams);
});

test("invalid existing filters and parameter containers return Invalid params", () => {
  for (const params of [
    undefined, null, "78701", 1, [], {},
    ["Ford", "Transit", 35000, "75201", "van", "extra"],
    { zipCode: "78701", unexpected: true },
    ...[{ make: null }, { make: 1 }, { model: [] }, { maxPrice: null },
      { maxPrice: "35000" }, { maxPrice: -1 }, { maxPrice: NaN }, { maxPrice: Infinity }]
      .map((filters) => ({ zipCode: "78701", ...filters })),
  ]) {
    assert.throws(() => searchInventory(params), invalidParams);
  }
});

test("returned listings cannot mutate inventory used by later calls", () => {
  const result = searchInventory({ zipCode: "78701", vehicleType: "sedan" });
  result[0].vehicleType = "van";
  result.reverse();
  assert.deepEqual(ids({ zipCode: "78701", vehicleType: "sedan" }), ["veh-1001", "veh-1002"]);
});

test("the spec keeps positional compatibility and optional listing classification", () => {
  assert.deepEqual(searchMethod.params.map(({ name }) => name), [
    "make", "model", "maxPrice", "zipCode", "vehicleType",
  ]);
  const typeParameter = searchMethod.params.at(-1);
  assert.equal(typeParameter.required, false);
  assert.equal(typeParameter.schema.type, "string");
  assert.deepEqual(typeParameter.schema.enum, ["sedan", "truck", "van"]);
  const listingSchema = spec.components.schemas.VehicleListing;
  assert.ok(!listingSchema.required.includes("vehicleType"));
  assert.deepEqual(listingSchema.properties.vehicleType.enum, typeParameter.schema.enum);
});
