# Car Purchase API

`openrpc.json` defines the API. The runnable JSON-RPC 2.0 HTTP server implements
**searchInventory only**, using six synthetic vehicle listings.
The other five methods are illustrative contracts, not implemented endpoints;
calling them returns `-32601 Method not found`.
Use Node.js 24 or newer. The server uses Node built-ins; npm dependencies are
development tools for contract tests and specification lint.

## Start the API

```bash
npm ci --ignore-scripts
npm start
```

The endpoint is `http://127.0.0.1:3000/`. Startup binds only to loopback, not to a
public interface. Use `PORT=3001 npm start` to change the port, or `PORT=0` to let
the operating system select one; the startup log prints the actual endpoint.
Stop with Ctrl+C. This fixture service has no authentication or persistence and
is not a production vehicle marketplace.

## Search

Pass named parameters or a positional array in this order:
`make`, `model`, `maxPrice`, `zipCode`, `vehicleType`.
Only `zipCode` is required. The new final parameter does not shift existing indexes.
`vehicleType` accepts exactly `sedan`, `truck`, or `van`. Omit it to search all types.
Make and model use exact, case-sensitive matches. All filters combine with AND;
`maxPrice` is inclusive and must be a finite nonnegative number.

In another terminal, search for trucks:

```bash
curl --silent --show-error http://127.0.0.1:3000/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"searchInventory","params":{"zipCode":"78701","vehicleType":"truck"}}'
```

The result contains `veh-2001` and `veh-2002`. Replace `truck` with `sedan` or `van`
for the other types, or remove `vehicleType` to return all six listings.
Combine criteria to select one affordable van:

```bash
curl --silent --show-error http://127.0.0.1:3000/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":"van-search","method":"searchInventory","params":{"make":"Ford","model":"Transit","maxPrice":35000,"zipCode":"75201","vehicleType":"van"}}'
```

Response:

```json
{"jsonrpc":"2.0","id":"van-search","result":[{"id":"veh-3001","make":"Ford","model":"Transit","vehicleType":"van","year":2023,"price":34999,"mileage":12000}]}
```

Positional callers can use `"params":["Toyota","Camry",30000,"78701","sedan"]`.
The callable `searchInventory` function remains available from `search-inventory.mjs`.

## Transport and errors

- Send UTF-8 JSON to `POST /` with `Content-Type: application/json`.
- JSON-RPC replies use HTTP 200, echo the request ID, and contain either `result`
  or `error`, never both. String, number, and null IDs are accepted.
- Missing IDs are notifications. Valid notifications, including failed method
  calls, receive HTTP 204 with no body. Batches omit notification replies;
  notification-only batches also receive 204. An empty batch is invalid.
- Invalid method parameters return `-32602 Invalid params`. This includes unknown
  vehicle types, non-string types (including null), malformed or missing ZIPs,
  invalid make/model/price values, and unknown filter names.
- No matches return `-32001 No inventory found for the given filters`, not an empty
  success array. Unknown methods return `-32601 Method not found`.
- Malformed JSON or invalid UTF-8 returns `-32700 Parse error`; malformed request
  objects, IDs, or non-object/non-array `params` return `-32600 Invalid Request`.
  These replies use a null ID. Unexpected failures use `-32603 Internal error`.
- HTTP transport failures are separate: wrong path 404, wrong verb 405,
  unsupported content type 415, and bodies over 64 KiB 413.
  Request and header timeouts are configured to 10 and 5 seconds.

For example, a request with ID `1` and `vehicleType: "suv"` returns:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid params"}}
```

## Fixture location limits

Results sort by distance, then ascending price. Distances in
`fixtures/inventory.json` are **synthetic**, defined only for `78701` and `75201`;
they are not measured driving or geographic distances.
ZIP+4 uses its five-digit prefix. Any other syntactically valid ZIP is accepted,
but all fixture distances are unknown and equal, so results sort only by price.
ZIP does not exclude listings. Production proximity search requires real location
data; this example does not provide production geolocation or persistence.
Listing `vehicleType` remains optional in the response schema for older producers.

## Validation

```bash
npm run verify
npm run test:api
```

`verify` runs syntax checks, all tests, and the pinned OpenRPC linter. `test:api`
runs only network/contract tests. Tests start actual HTTP servers on ephemeral
loopback ports; no separately running server is required. CI uses the lockfile
and runs the same checks.

`@open-rpc/test-coverage` runs all three search examples over HTTP. Its example
rule is adapted to retain names when optional parameters are absent. The tool is
scoped to **one of the six documented methods**, not the entire illustrative API.
It can accept schema-compatible example mismatches, so separate assertions check
exact expected results and Ajv validates real response schemas, with negative
controls for invalid listings. Additional network tests check each filter, invalid
values, positional calls, ZIP ranking, request/error envelopes, notifications,
batches, body limits, and CLI startup. Example/method coverage alone does not prove
semantic correctness.

The coverage tool's Ajv 7 dependency is overridden with the pinned Ajv 8 validator
to avoid its ReDoS advisory; the integration runs under this override.
The pinned recommended lint rules allow at most four method parameters.
`searchInventory` retains five for positional compatibility, so lint reports one
parameter-count warning. There are no documentation or license warnings.
