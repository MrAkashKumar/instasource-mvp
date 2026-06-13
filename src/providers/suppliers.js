const { MOCK_SUPPLIERS } = require("../data/mock-suppliers");
const { inferProcessFromText } = require("../utils/scoring");

async function discoverSuppliers(spec, request, config, requestId) {
  const errors = [];
  if (config.brightData.apiKey) {
    try {
      const live = await discoverWithBrightData(spec, request, config, requestId);
      if (live.candidates.length > 0) return live;
      if (config.liveOnly && !config.fallbackToMock) {
        throw liveProviderError("Bright Data returned no supplier candidates for the extracted specification.", 502);
      }
      errors.push("Bright Data returned no supplier candidates for the extracted specification.");
    } catch (error) {
      errors.push(error.message);
      console.warn(`Bright Data discovery failed: ${error.message}`);
      if (config.liveOnly && !config.fallbackToMock) throw liveProviderError(error.message, error.statusCode || 502);
    }
  }

  if (config.liveOnly && !config.fallbackToMock) {
    if (!config.brightData.apiKey) {
      throw liveProviderError("Live-only mode requires BRIGHT_DATA_API_KEY for supplier discovery.", 500);
    }
  }

  const candidates = discoverWithMockDirectory(spec);
  return {
    candidates,
    discovery: {
      id: `mock_${Date.now()}`,
      requestId,
      provider: "mock-directory",
      status: "mock",
      query: errors.length ? "Bright Data fallback to local supplier directory" : "local fallback directory",
      sources: errors.length ? [{ title: "Bright Data fallback", status: "fallback", chars: errors.join(" | ").length }] : [],
      documents: errors.length ? [{ title: "Bright Data fallback reason", content: errors.join(" | "), snippet: errors.join(" | "), chars: errors.join(" | ").length }] : [],
      candidates,
      fallbackReason: errors.join(" | "),
      createdAt: new Date().toISOString(),
    },
  };
}

function liveProviderError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function discoverWithBrightData(spec, request, config, requestId) {
  const query = [
    spec.material,
    spec.process,
    "contract manufacturer",
    request.destinationCountry,
  ]
    .filter(Boolean)
    .join(" ");

  const urls = [
    `https://www.google.com/search?q=${encodeURIComponent(`${query} Thomasnet supplier`)}`,
    `https://www.google.com/search?q=${encodeURIComponent(`${query} Alibaba manufacturer`)}`,
  ];

  const documents = [];
  const sources = [];
  for (const url of urls) {
    const body = {
      url,
      format: "json",
      method: "GET",
      data_format: "markdown",
      country: countryForSearch(request.destinationCountry),
    };
    if (config.brightData.zoneReady) body.zone = config.brightData.zone;

    const response = await fetchWithTimeout(config.brightData.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.brightData.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }, config.brightData.timeoutMs);

    if (!response.ok) {
      throw new Error(await providerError("Bright Data", response));
    }

    const data = await response.json();
    const text = String(data.body || data.content || data.markdown || JSON.stringify(data)).slice(0, 12000);
    documents.push({
      url,
      title: sourceTitle(url),
      chars: text.length,
      content: text,
      snippet: text.slice(0, 900),
    });
    sources.push({
      url,
      title: sourceTitle(url),
      status: response.status,
      chars: text.length,
    });
  }

  const candidates = extractSupplierCandidates(documents.map((doc) => doc.content).join("\n"), spec);
  return {
    candidates,
    discovery: {
      id: `bd_${Date.now()}`,
      requestId,
      provider: "bright-data",
      status: "completed",
      query,
      sources,
      documents,
      candidates,
      createdAt: new Date().toISOString(),
      zoneUsed: config.brightData.zoneReady ? config.brightData.zone : "",
    },
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Bright Data timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function providerError(provider, response) {
  const body = await response.text().catch(() => "");
  const message = extractProviderMessage(body);
  return `${provider} returned ${response.status}${message ? `: ${message}` : ""}`;
}

function extractProviderMessage(body) {
  if (!body) return "";
  try {
    const data = JSON.parse(body);
    return data.error?.message || data.message || JSON.stringify(data).slice(0, 240);
  } catch {
    return body.slice(0, 240);
  }
}

function extractSupplierCandidates(markdown, spec) {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30 && /manufacturer|supplier|cnc|machining|molding|pcb|fabrication/i.test(line));

  const candidates = [];
  for (const line of lines.slice(0, 8)) {
    const name = line
      .replace(/^\*+|\[|\]|\(|\)/g, "")
      .split(/[-|:]/)[0]
      .trim()
      .slice(0, 80);
    if (!name || candidates.some((candidate) => candidate.name === name)) continue;
    candidates.push({
      id: `live-${candidates.length + 1}`,
      name,
      country: "Unknown",
      region: "Public web result",
      processes: [spec.process || inferProcessFromText(line)],
      materials: [spec.material],
      certifications: ["Needs verification"],
      minOrderQty: 1,
      leadTimeDays: 21,
      unitCostBaseUsd: 42,
      shippingBaseUsd: 280,
      publicSignals: [line.slice(0, 220)],
      source: "bright-data-web",
      sourceUrl: "",
    });
  }

  return candidates;
}

function sourceTitle(url) {
  if (url.includes("Thomasnet")) return "Google results: Thomasnet suppliers";
  if (url.includes("Alibaba")) return "Google results: Alibaba manufacturers";
  return "Bright Data web source";
}

function discoverWithMockDirectory(spec) {
  const process = spec.process.toLowerCase();
  const material = spec.material.toLowerCase();

  return MOCK_SUPPLIERS.filter((supplier) => {
    const processMatch = supplier.processes.some((item) => process.includes(item.toLowerCase()) || item.toLowerCase().includes(process));
    const materialMatch = supplier.materials.some((item) => material.includes(item.toLowerCase().split(" ")[0]));
    return processMatch || materialMatch;
  }).slice(0, 7);
}

function countryForSearch(destinationCountry) {
  const country = String(destinationCountry || "US").toLowerCase();
  if (country === "sg" || country === "singapore") return "sg";
  if (country === "in" || country === "india") return "in";
  if (country === "gb" || country === "uk") return "gb";
  return "us";
}

module.exports = { discoverSuppliers };
