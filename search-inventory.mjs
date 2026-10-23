import inventory from "./fixtures/inventory.json" with { type: "json" };

const parameterNames = ["make", "model", "maxPrice", "zipCode", "vehicleType"];
const vehicleTypes = ["sedan", "truck", "van"];

class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function searchInventory(params) {
  if (
    params === null ||
    typeof params !== "object" ||
    (Array.isArray(params)
      ? params.length > parameterNames.length
      : Object.keys(params).some((name) => !parameterNames.includes(name)))
  ) {
    throw new SearchError(-32602, "Invalid params");
  }

  const { make, model, maxPrice, zipCode, vehicleType } = Array.isArray(params)
    ? Object.fromEntries(parameterNames.map((name, index) => [name, params[index]]))
    : params;

  if (
    (make !== undefined && typeof make !== "string") ||
    (model !== undefined && typeof model !== "string") ||
    (maxPrice !== undefined &&
      (typeof maxPrice !== "number" || !Number.isFinite(maxPrice) || maxPrice < 0)) ||
    typeof zipCode !== "string" ||
    !/^\d{5}(-\d{4})?$/.test(zipCode) ||
    (vehicleType !== undefined && !vehicleTypes.includes(vehicleType))
  ) {
    throw new SearchError(-32602, "Invalid params");
  }

  const matches = inventory.filter(({ listing }) =>
    (make === undefined || listing.make === make) &&
    (model === undefined || listing.model === model) &&
    (maxPrice === undefined || listing.price <= maxPrice) &&
    (vehicleType === undefined || listing.vehicleType === vehicleType)
  );

  if (matches.length === 0) {
    throw new SearchError(-32001, "No inventory found for the given filters");
  }

  const distance = (entry) => entry.distanceMilesByZip[zipCode.slice(0, 5)] ?? Infinity;
  return matches
    .sort((a, b) => distance(a) - distance(b) || a.listing.price - b.listing.price)
    .map(({ listing }) => ({ ...listing }));
}
