async function generateFeasibilityReport(spec, suppliers, logistics, request, config) {
  if (config.kimi.apiKey) {
    try {
      return await generateWithKimi(spec, suppliers, logistics, request, config);
    } catch (error) {
      console.warn(`Kimi report generation failed: ${error.message}`);
      if (config.liveOnly && !config.fallbackToMock) throw liveProviderError(error.message, error.statusCode || 502);
      return {
        ...generateDeterministicReport(spec, suppliers, logistics),
        source: "fallback-deterministic",
        fallbackReason: error.message,
      };
    }
  }

  if (config.liveOnly && !config.fallbackToMock) {
    throw liveProviderError("Live-only mode requires KIMI_API_KEY for report generation.", 500);
  }

  return {
    ...generateDeterministicReport(spec, suppliers, logistics),
    source: "deterministic",
  };
}

function liveProviderError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function generateWithKimi(spec, suppliers, logistics, request, config) {
  const body = {
    model: config.kimi.reportModel || config.kimi.model,
    max_tokens: config.kimi.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are a sourcing analyst for custom manufacturing.",
          "Return compact valid JSON only.",
          "The JSON object must include: summary, feasibility, topRecommendation, risks, supplierNotes, costRangeUsd, timelineDays, confidence, questionsForBuyer.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Create a sourcing feasibility report as strict JSON.",
          JSON.stringify({ spec, suppliers: suppliers.slice(0, 3), logistics, destination: request.destinationCountry }),
        ].join("\n"),
      },
    ],
  };
  const thinking = kimiThinking(body.model);
  if (thinking) body.thinking = thinking;
  const temperature = kimiTemperature(body.model);
  if (temperature !== undefined) body.temperature = temperature;

  const response = await fetchWithTimeout(`${config.kimi.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kimi.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, config.kimi.timeoutMs);

  if (!response.ok) throw new Error(await providerError("Kimi", response));
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseJsonObject(content);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Kimi timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function kimiTemperature(model) {
  if (!process.env.KIMI_TEMPERATURE) return undefined;
  return Number(process.env.KIMI_TEMPERATURE);
}

function kimiThinking(model) {
  const value = String(process.env.KIMI_THINKING || "disabled").toLowerCase();
  const modelName = String(model || "").toLowerCase();
  if (value !== "disabled") return undefined;
  if (modelName.includes("k2.6") || modelName.includes("k2.5")) {
    return { type: "disabled" };
  }
  return undefined;
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

function generateDeterministicReport(spec, suppliers, logistics) {
  const top = suppliers[0];
  const costs = suppliers.slice(0, 3).map((supplier) => supplier.estimatedTotalUsd);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  return {
    summary: `${spec.partName} is feasible for sourcing as ${spec.process} using ${spec.material}. The ranking favors suppliers with matching process capability, material experience, certification coverage, and landed cost.`,
    feasibility: top ? "Feasible with engineering review" : "Needs supplier discovery",
    topRecommendation: top ? `${top.name} has the strongest current fit at score ${top.score}/100.` : "No supplier matched strongly enough.",
    risks: [
      "Dimensions and drawing scale must be verified before firm quotes.",
      "Public supplier data may be stale; request DFM feedback and signed quotation.",
      "Customs duties are estimates until HS code and shipper documentation are confirmed.",
    ],
    supplierNotes: suppliers.slice(0, 3).map((supplier) => ({
      supplier: supplier.name,
      reason: supplier.matchReasons.join("; "),
      estimatedUnitCostUsd: supplier.estimatedUnitCostUsd,
      estimatedLeadTimeDays: supplier.estimatedLeadTimeDays,
    })),
    costRangeUsd: {
      low: roundMoney(minCost),
      high: roundMoney(maxCost),
    },
    timelineDays: {
      fastest: Math.min(...suppliers.slice(0, 3).map((supplier) => supplier.estimatedLeadTimeDays)),
      conservative: Math.max(...suppliers.slice(0, 3).map((supplier) => supplier.estimatedLeadTimeDays)) + 7,
    },
    confidence: spec.confidence < 0.6 ? "medium-low" : "medium",
    questionsForBuyer: [
      "Can you confirm the drawing revision and all controlled dimensions?",
      "Is this prototype, pilot, or production volume?",
      "Are material certificates, RoHS, REACH, or country-of-origin constraints required?",
    ],
  };
}

function parseJsonObject(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Kimi response did not include JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = { generateFeasibilityReport };
