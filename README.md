# Car Purchase API

`openrpc.json` defines the API. This repository also includes a first, dependency-free
reference implementation of `searchInventory` using six synthetic vehicle listings.
It is a callable function, not a JSON-RPC server. Other API methods have no runtime.
Use Node.js 24 or newer; no package installation is required for search or tests.

## Search

Pass named parameters or a positional array in this order:
`make`, `model`, `maxPrice`, `zipCode`, `vehicleType`.
Only `zipCode` is required. The new final parameter does not shift existing indexes.
`vehicleType` accepts exactly `sedan`, `truck`, or `van`. Omit it to search all types.
Make and model use exact, case-sensitive matches. All filters combine with AND;
`maxPrice` is inclusive and must be a finite nonnegative number.

Run from the repository root:

```bash
node --input-type=module <<'JS'
import { searchInventory } from "./search-inventory.mjs";

for (const vehicleType of ["sedan", "truck", "van"]) {
  console.log(vehicleType, searchInventory({ zipCode: "78701", vehicleType }).map(v => v.id));
}
console.log(searchInventory({
  make: "Ford", model: "Transit", maxPrice: 35000, zipCode: "75201", vehicleType: "van"
}));
console.log(searchInventory({ zipCode: "78701" }).length);
console.log(searchInventory(["Toyota", "Camry", 30000, "78701", "sedan"]));
JS
```

The type-only searches return two listings each. The combined search returns
`veh-3001`, omission returns all six listings, and the positional search returns
`veh-1001`. The OpenRPC search examples are checked against the reference runtime.

Invalid parameters throw an `Error` with `code: -32602` and message `Invalid params`.
This includes unknown or non-string vehicle types (including `null`), invalid
existing filter types, missing or malformed ZIPs, and unknown parameter names.
No matches throw `code: -32001` with message `No inventory found for the given filters`.
For example, `{ zipCode: "78701", vehicleType: "suv" }` is invalid, while
`{ zipCode: "78701", vehicleType: "van", make: "Toyota" }` has no matches.

## Fixture location limits

Results sort by distance, then ascending price. Distances in
`fixtures/inventory.json` are **synthetic**, defined only for `78701` and `75201`;
they are not measured driving or geographic distances.
ZIP+4 uses its five-digit prefix. Any other syntactically valid ZIP is accepted,
but all fixture distances are unknown and equal, so results sort only by price.
ZIP does not exclude listings. Production proximity search requires real location
data; this example does not provide geolocation, persistence, or an HTTP service.
Listing `vehicleType` remains optional in the response schema for older producers.

## Validation

```bash
node --check search-inventory.mjs
node --check test/search-inventory.test.mjs
node --test
npx --yes @open-rpc/openrpc-linter@0.0.18 lint openrpc.json -r rules.yml
```

CI runs the search tests and specification lint. The specification has existing
recommended-rule warnings; the lint command reports them without failing.
