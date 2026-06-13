async function generateFeasibilityReport(spec, suppliers, logistics, request, config) {
  if (config.kimi.apiKey) {
    try {
      return await generateWithKimi(spec, suppliers, logistics, request, config);
    } catch (error) {
      console.warn(`Kimi report generation failed, falling back: ${error.message}`);
    }
  }

  return generateDeterministicReport(spec, suppliers, logistics);
}

async function generateWithKimi(spec, suppliers, logistics, request, config) {
  const response = await fetch(`${config.kimi.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kimi.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.kimi.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a sourcing analyst for custom manufacturing. Be concise, conservative, and explicit about uncertainty.",
        },
        {
          role: "user",
          content: [
            "Create a sourcing feasibility report as strict JSON.",
            "Fields: summary, feasibility, topRecommendation, risks, supplierNotes, costRangeUsd, timelineDays, confidence, questionsForBuyer.",
            JSON.stringify({ spec, suppliers: suppliers.slice(0, 3), logistics, destination: request.destinationCountry }),
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Kimi returned ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return parseJsonObject(content);
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
