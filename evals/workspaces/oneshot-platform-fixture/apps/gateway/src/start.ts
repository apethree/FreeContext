const service = (process.env.SERVICE_NAME || "gateway-realtime").trim().toLowerCase();

if (service === "gateway-api") {
  await import("./api/server.js");
} else if (service === "gateway-workers") {
  await import("./workers/server.js");
} else {
  await import("./realtime/server.js");
}
