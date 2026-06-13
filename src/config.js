const fs = require("fs");
const path = require("path");

function loadConfig() {
  loadDotEnv(path.join(__dirname, "..", ".env"));

  const providerStatus = {
    senseNova: Boolean(process.env.SENSENOVA_API_KEY && process.env.SENSENOVA_API_URL),
    kimi: Boolean(process.env.KIMI_API_KEY),
    brightData: Boolean(process.env.BRIGHT_DATA_API_KEY),
    daytona: Boolean(process.env.DAYTONA_API_KEY),
    terminal3: Boolean(process.env.TERMINAL3_API_KEY),
  };

  return {
    nodeEnv: process.env.NODE_ENV || "production",
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 4123),
    hasLiveProviders: Object.values(providerStatus).some(Boolean),
    providerStatus,
    senseNova: {
      apiKey: process.env.SENSENOVA_API_KEY || "",
      apiUrl: process.env.SENSENOVA_API_URL || "",
      model: process.env.SENSENOVA_MODEL || "SenseNova-U1",
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY || "",
      baseUrl: trimRight(process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1", "/"),
      model: process.env.KIMI_MODEL || "kimi-k2.6",
    },
    brightData: {
      apiKey: process.env.BRIGHT_DATA_API_KEY || "",
      zone: process.env.BRIGHT_DATA_ZONE || "",
      endpoint: process.env.BRIGHT_DATA_ENDPOINT || "https://api.brightdata.com/request",
    },
    daytona: {
      apiKey: process.env.DAYTONA_API_KEY || "",
      apiUrl: trimRight(process.env.DAYTONA_API_URL || "https://app.daytona.io", "/"),
    },
    terminal3: {
      apiKey: process.env.TERMINAL3_API_KEY || "",
      actionUrl: process.env.TERMINAL3_ACTION_URL || "",
    },
  };
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
