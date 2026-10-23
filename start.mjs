import { createSearchServer } from "./server.mjs";

const portValue = process.env.PORT ?? "3000";
const port = Number(portValue);

if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("PORT must be an integer from 0 to 65535.");
  process.exitCode = 1;
} else {
  const server = createSearchServer();
  server.on("error", (error) => {
    console.error(`Could not start inventory search API: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Inventory search API listening at http://127.0.0.1:${server.address().port}`);
  });
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
}
