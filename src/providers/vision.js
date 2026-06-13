const { inferProcessFromText } = require("../utils/scoring");

async function extractSpecification(request, config) {
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
      console.warn(`SenseNova extraction failed, falling back: ${error.message}`);
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
      console.warn(`Kimi vision extraction failed, falling back: ${error.message}`);
    }
  }

  return mockExtractSpecification(request);
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

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
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
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision API returned ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(content);

  return {
    ...normalizeSpec(parsed, request),
    source,
  };
}

function mockExtractSpecification(request) {
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
      "Exact dimensions were not read because no live vision API key is configured.",
      "Cost estimates use category-level manufacturing heuristics.",
    ],
    confidence: request.fileBase64 ? 0.58 : 0.42,
    source: "mock-heuristic",
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
