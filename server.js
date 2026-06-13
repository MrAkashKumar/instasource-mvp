const http = require("http");
const path = require("path");
const { loadConfig } = require("./src/config");
const { readJsonBody, sendJson, serveStatic } = require("./src/http");
const { runSourcingAnalysis } = require("./src/pipeline");
const { listDiscoveries, getDiscovery } = require("./src/discovery-store");

const config = loadConfig();
const publicDir = path.join(__dirname, "public");

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "InstaSource MVP",
        mode: config.liveOnly && !config.fallbackToMock
          ? "live-only"
          : config.hasLiveProviders
            ? "live-with-mock-fallback"
            : "mock",
        fallbackToMock: config.fallbackToMock,
        providers: config.providerStatus,
        warnings: config.setupWarnings,
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/discoveries") {
      sendJson(res, 200, { discoveries: listDiscoveries() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/discoveries/")) {
      const id = decodeURIComponent(req.url.split("?")[0].replace("/api/discoveries/", ""));
      const discovery = getDiscovery(id);
      if (!discovery) {
        sendJson(res, 404, { error: "Discovery not found" });
        return;
      }
      sendJson(res, 200, { discovery });
      return;
    }

    if (req.method === "POST" && req.url === "/api/source") {
      const payload = await readJsonBody(req, 18 * 1024 * 1024);
      const result = await runSourcingAnalysis(payload, config);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, publicDir);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: status === 500 && !error.expose ? "Internal server error" : error.message,
      detail: config.nodeEnv === "development" ? error.stack : undefined,
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`InstaSource MVP running at http://${config.host}:${config.port}`);
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
