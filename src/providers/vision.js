const { inferProcessFromText } = require("../utils/scoring");

async function extractSpecification(request, config) {
  const errors = [];
  if (config.senseNova.apiKey && config.senseNova.apiUrl && request.fileBase64) {
    try {
      return await extractWithOpenAICompatibleVision({
        apiUrl: config.senseNova.apiUrl,
        apiKey: config.senseNova.apiKey,
        model: config.senseNova.model,
        request,
        source: "sensanova",
      });
    } catch (error) {
      errors.push(`SenseNova extraction failed: ${error.message}`);
      console.warn(errors[errors.length - 1]);
      if (config.liveOnly && !config.fallbackToMock && !config.kimi.apiKey) {
        throw liveProviderError(errors.join(" | "), 502);
      }
    }
  }

  if (config.kimi.apiKey && request.fileBase64) {
    try {
      return await extractWithOpenAICompatibleVision({
        apiUrl: `${config.kimi.baseUrl}/chat/completions`,
        apiKey: config.kimi.apiKey,
        model: config.kimi.model,
        request,
        source: "kimi-vision",
      });
    } catch (error) {
      errors.push(`Kimi vision extraction failed: ${error.message}`);
      console.warn(errors[errors.length - 1]);
    }
  }

  if (config.liveOnly && !config.fallbackToMock) {
    if (!request.fileBase64) {
      throw liveProviderError("Live-only mode requires an uploaded blueprint/image file for vision extraction.", 400);
    }
    if (!config.senseNova.apiKey && !config.kimi.apiKey) {
      throw liveProviderError("Live-only mode requires SENSENOVA_API_KEY or KIMI_API_KEY for vision extraction.", 500);
    }
    throw liveProviderError(
      errors.length
        ? errors.join(" | ")
        : "Live vision extraction failed before any provider returned a usable specification.",
      502
    );
  }

  return mockExtractSpecification(request, errors);
}

function liveProviderError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

async function extractWithOpenAICompatibleVision({ apiUrl, apiKey, model, request, source }) {
  const imageUrl = `data:${request.mimeType || "image/png"};base64,${request.fileBase64}`;
  const prompt = [
    "Extract a manufacturing specification from this blueprint or product image.",
    "Return strict JSON only.",
    "Fields: partName, material, process, dimensions, tolerances, finish, quantity, certifications, criticalFeatures, assumptions, confidence.",
    `User hints: material=${request.materialHint || "unknown"}, process=${request.processHint || "unknown"}, finish=${request.finishHint || "unknown"}, tolerance=${request.toleranceHint || "unknown"}, quantity=${request.quantity}.`,
    "If a dimension is not visible, do not invent it; put it in assumptions.",
  ].join(" ");

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "You are a manufacturing engineer. Extract conservative specs and call out uncertainty.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
  if (source === "kimi-vision") {
    body.response_format = { type: "json_object" };
    if (String(model || "").toLowerCase().includes("k2.6")) body.thinking = { type: "disabled" };
  } else {
    body.temperature = 0.1;
  }

  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, source === "kimi-vision" ? configTimeoutFromRequest(request) : 20000);

  if (!response.ok) {
    const modelHint = response.status === 404
      ? ` Check SENSENOVA_MODEL/KIMI_MODEL. Current model "${model}" was not accepted by ${source}.`
      : "";
    throw new Error(`${await providerError("Vision API", response)}${modelHint}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(content);

  return {
    ...normalizeSpec(parsed, request),
    source,
  };
}

function configTimeoutFromRequest() {
  return Number(process.env.KIMI_TIMEOUT_MS || 20000);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Vision API timed out after ${timeoutMs}ms`);
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

function mockExtractSpecification(request, errors = []) {
  const process = request.processHint || inferProcessFromText(`${request.partName} ${request.materialHint}`);
  const material = request.materialHint || defaultMaterialForProcess(process);
  const finish = request.finishHint || defaultFinishForMaterial(material);

  return {
    partName: request.partName,
    material,
    process,
    dimensions: "Unverified from upload; requester must confirm drawing scale and revision.",
    tolerances: request.toleranceHint || "+/- 0.10 mm general unless drawing states otherwise",
    finish,
    quantity: request.quantity,
    certifications: ["ISO 9001 preferred", "Material certificate required"],
    criticalFeatures: ["Drawing revision control", "First article inspection", "DFM review before tooling or machining"],
    assumptions: [
      errors.length
        ? `Live vision fallback used: ${errors.join(" | ")}`
        : "Exact dimensions were not read because no live vision API key is configured.",
      "Cost estimates use category-level manufacturing heuristics.",
    ],
    confidence: request.fileBase64 ? 0.58 : 0.42,
    source: errors.length ? "fallback-mock-heuristic" : "mock-heuristic",
    fallbackReason: errors.join(" | "),
  };
}

function normalizeSpec(spec, request) {
  return {
    partName: stringOr(spec.partName, request.partName),
    material: stringOr(spec.material, request.materialHint || "Material not confirmed"),
    process: stringOr(spec.process, request.processHint || inferProcessFromText(request.partName)),
    dimensions: stringOr(spec.dimensions, "Dimensions not confirmed"),
    tolerances: stringOr(spec.tolerances, request.toleranceHint || "Tolerance not confirmed"),
    finish: stringOr(spec.finish, request.finishHint || "Finish not confirmed"),
    quantity: Number(spec.quantity || request.quantity),
    certifications: arrayOr(spec.certifications, ["ISO 9001 preferred"]),
    criticalFeatures: arrayOr(spec.criticalFeatures, []),
    assumptions: arrayOr(spec.assumptions, []),
    confidence: clamp(Number(spec.confidence || 0.7), 0, 1),
  };
}

function parseJsonObject(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Vision response did not include JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

function stringOr(value, fallback) {
  return value ? String(value).trim() : fallback;
}

function arrayOr(value, fallback) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultMaterialForProcess(process) {
  const text = process.toLowerCase();
  if (text.includes("pcb")) return "FR-4 PCB laminate";
  if (text.includes("mold")) return "ABS or PC plastic";
  if (text.includes("sheet")) return "Stainless steel 304";
  return "Aluminum 6061";
}

function defaultFinishForMaterial(material) {
  const text = material.toLowerCase();
  if (text.includes("aluminum")) return "Clear or black anodized";
  if (text.includes("steel")) return "Deburred, passivated where applicable";
  if (text.includes("plastic")) return "As molded, texture TBD";
  return "As specified on drawing";
}

module.exports = { extractSpecification };
