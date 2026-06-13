const fs = require("fs");
const path = require("path");

function loadConfig() {
  loadDotEnv(path.join(__dirname, "..", ".env"));

  const brightDataZone = process.env.BRIGHT_DATA_ZONE
    || process.env.BRIGHTDATA_UNLOCKER_ZONE
    || process.env.BRIGHTDATA_SERP_ZONE
    || "";
  const senseNovaRawApiUrl = process.env.SENSENOVA_API_URL || "";
  const senseNovaApiUrl = normalizeChatCompletionsUrl(senseNovaRawApiUrl);
  const brightDataApiKey = process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHTDATA_API_KEY || "";
  const terminal3ApiKey = process.env.TERMINAL3_API_KEY || process.env.T3N_API_KEY || "";
  const setupWarnings = [];

  const providerStatus = {
    senseNova: Boolean(process.env.SENSENOVA_API_KEY && senseNovaApiUrl),
    kimi: Boolean(process.env.KIMI_API_KEY),
    brightData: Boolean(brightDataApiKey),
    daytona: Boolean(process.env.DAYTONA_API_KEY),
    terminal3: Boolean(terminal3ApiKey),
  };

  return {
    nodeEnv: process.env.NODE_ENV || "production",
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4123),
    liveOnly: String(process.env.LIVE_ONLY || "true").toLowerCase() !== "false",
    fallbackToMock: String(process.env.FALLBACK_TO_MOCK || "true").toLowerCase() !== "false",
    hasLiveProviders: Object.values(providerStatus).some(Boolean),
    providerStatus,
    setupWarnings,
    senseNova: {
      apiKey: process.env.SENSENOVA_API_KEY || "",
      apiUrl: senseNovaApiUrl,
      rawApiUrl: senseNovaRawApiUrl,
      model: process.env.SENSENOVA_MODEL || "SenseNova-U1",
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY || "",
      baseUrl: trimRight(process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1", "/"),
      model: process.env.KIMI_MODEL || "kimi-k2.6",
      reportModel: process.env.KIMI_REPORT_MODEL || "moonshot-v1-8k",
      timeoutMs: Number(process.env.KIMI_TIMEOUT_MS || 20000),
      maxTokens: Number(process.env.KIMI_MAX_TOKENS || 2000),
    },
    brightData: {
      apiKey: brightDataApiKey,
      zone: brightDataZone,
      zoneReady: isLikelyBrightDataZone(brightDataZone),
      endpoint: process.env.BRIGHT_DATA_ENDPOINT || "https://api.brightdata.com/request",
      timeoutMs: Number(process.env.BRIGHT_DATA_TIMEOUT_MS || 12000),
    },
    daytona: {
      apiKey: process.env.DAYTONA_API_KEY || "",
      apiUrl: trimRight(process.env.DAYTONA_API_URL || "https://app.daytona.io", "/"),
    },
    terminal3: {
      apiKey: terminal3ApiKey,
      environment: process.env.TERMINAL3_ENVIRONMENT || process.env.T3N_ENVIRONMENT || "testnet",
    },
  };
}

function isLikelyBrightDataZone(zone) {
  const value = String(zone || "").trim();
  if (!value) return false;
  if (/^[a-z]{2}$/i.test(value)) return false;
  return /^[a-zA-Z0-9_-]{3,80}$/.test(value);
}

function normalizeChatCompletionsUrl(value) {
  const url = trimRight(String(value || "").trim(), "/");
  if (!url) return "";
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return url;
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function trimRight(value, char) {
  while (value.endsWith(char)) value = value.slice(0, -1);
  return value;
}

module.exports = { loadConfig };
