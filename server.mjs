import { createServer } from "node:http";
import { SearchError, searchInventory } from "./search-inventory.mjs";

const maxBodyBytes = 64 * 1024;

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleCall(request) {
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string" ||
    (Object.hasOwn(request, "params") &&
      (request.params === null || typeof request.params !== "object")) ||
    (Object.hasOwn(request, "id") &&
      request.id !== null &&
      typeof request.id !== "string" &&
      !(typeof request.id === "number" && Number.isFinite(request.id)))
  ) {
    return rpcError(null, -32600, "Invalid Request");
  }

  let response;
  if (request.method !== "searchInventory") {
    response = rpcError(request.id, -32601, "Method not found");
  } else {
    try {
      response = { jsonrpc: "2.0", id: request.id, result: searchInventory(request.params) };
    } catch (error) {
      response = error instanceof SearchError
        ? rpcError(request.id, error.code, error.message)
        : rpcError(request.id, -32603, "Internal error");
    }
  }
  return Object.hasOwn(request, "id") ? response : null;
}

function sendResponse(response, body) {
  if (body === null) {
    response.writeHead(204).end();
  } else {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
}

export function createSearchServer() {
  return createServer({
    requestTimeout: 10000,
    headersTimeout: 5000,
    keepAliveTimeout: 1000,
    maxHeaderSize: 8192,
  }, (request, response) => {
    if (request.url !== "/") {
      response.writeHead(404).end();
      request.resume();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      request.resume();
      return;
    }
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      response.writeHead(415).end();
      request.resume();
      return;
    }

    let size = 0;
    const chunks = [];
    request.on("error", () => response.destroy());
    request.on("data", (chunk) => {
      if (response.writableEnded) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        chunks.length = 0;
        response.writeHead(413, { Connection: "close" }).end();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      let payload;
      try {
        payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        sendResponse(response, rpcError(null, -32700, "Parse error"));
        return;
      }
      if (Array.isArray(payload)) {
        if (payload.length === 0) {
          sendResponse(response, rpcError(null, -32600, "Invalid Request"));
          return;
        }
        const replies = payload.map(handleCall).filter((reply) => reply !== null);
        sendResponse(response, replies.length > 0 ? replies : null);
      } else {
        sendResponse(response, handleCall(payload));
      }
    });
  });
}
