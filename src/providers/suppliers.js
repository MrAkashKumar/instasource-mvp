const { MOCK_SUPPLIERS } = require("../data/mock-suppliers");
const { inferProcessFromText } = require("../utils/scoring");

async function discoverSuppliers(spec, request, config) {
  if (config.brightData.apiKey && config.brightData.zoneReady) {
    try {
      const live = await discoverWithBrightData(spec, request, config);
      if (live.length > 0) return live;
    } catch (error) {
      console.warn(`Bright Data discovery failed, falling back: ${error.message}`);
    }
  }

  return discoverWithMockDirectory(spec);
}

async function discoverWithBrightData(spec, request, config) {
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
  for (const url of urls) {
    const response = await fetchWithTimeout(config.brightData.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.brightData.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zone: config.brightData.zone,
        url,
        format: "json",
        method: "GET",
        data_format: "markdown",
        country: countryForSearch(request.destinationCountry),
      }),
    }, config.brightData.timeoutMs);

    if (!response.ok) {
      throw new Error(await providerError("Bright Data", response));
    }

    const data = await response.json();
    documents.push(String(data.body || data.content || data.markdown || JSON.stringify(data)).slice(0, 12000));
  }

  return extractSupplierCandidates(documents.join("\n"), spec);
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
    });
  }

  return candidates;
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
