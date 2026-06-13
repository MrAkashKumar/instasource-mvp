function rankSuppliers(spec, suppliers, logistics) {
  return suppliers
    .map((supplier) => {
      const match = scoreSupplier(spec, supplier);
      const logisticsEstimate = logistics.estimates[supplier.id] || {};
      const estimatedUnitCostUsd = estimateUnitCost(spec, supplier);
      const estimatedLeadTimeDays = (supplier.leadTimeDays || 21) + (logisticsEstimate.shippingDays || 8);
      const estimatedTotalUsd =
        estimatedUnitCostUsd * Number(spec.quantity || 1) +
        Number(logisticsEstimate.freightUsd || 0) +
        Number(logisticsEstimate.dutyUsd || 0);

      return {
        ...supplier,
        score: match.score,
        matchReasons: match.reasons,
        estimatedUnitCostUsd: roundMoney(estimatedUnitCostUsd),
        estimatedTotalUsd: roundMoney(estimatedTotalUsd),
        estimatedLeadTimeDays,
        logistics: logisticsEstimate,
      };
    })
    .sort((a, b) => b.score - a.score || a.estimatedTotalUsd - b.estimatedTotalUsd);
}

function scoreSupplier(spec, supplier) {
  const reasons = [];
  let score = 35;

  const processText = String(spec.process || "").toLowerCase();
  const materialText = String(spec.material || "").toLowerCase();

  if (supplier.processes.some((process) => containsEither(processText, process))) {
    score += 22;
    reasons.push("Process capability match");
  }

  if (supplier.materials.some((material) => containsEither(materialText, material))) {
    score += 18;
    reasons.push("Material experience match");
  }

  if ((supplier.minOrderQty || 1) <= Number(spec.quantity || 1)) {
    score += 8;
    reasons.push("MOQ fits requested quantity");
  }

  if (supplier.certifications.some((cert) => /iso|iatf|as9100|ul|ipc/i.test(cert))) {
    score += 8;
    reasons.push("Relevant quality certifications");
  }

  if ((supplier.leadTimeDays || 30) <= 18) {
    score += 4;
    reasons.push("Fast baseline lead time");
  }

  if (supplier.source === "bright-data-web") {
    reasons.push("Live public web candidate; needs validation");
  } else {
    reasons.push("Curated mock supplier profile");
  }

  return {
    score: Math.min(100, Math.round(score)),
    reasons,
  };
}

function estimateUnitCost(spec, supplier) {
  const quantity = Math.max(1, Number(spec.quantity || 1));
  const setup = supplier.setupCostUsd || 300;
  const materialMultiplier = materialMultiplierFor(spec.material);
  const processMultiplier = processMultiplierFor(spec.process);
  const volumeDiscount = Math.max(0.58, 1 - Math.log10(quantity) * 0.11);
  const base = Number(supplier.unitCostBaseUsd || 40);
  return (base * materialMultiplier * processMultiplier * volumeDiscount) + setup / quantity;
}

function inferProcessFromText(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("pcb") || value.includes("circuit")) return "PCB fabrication";
  if (value.includes("mold") || value.includes("injection") || value.includes("plastic")) return "Injection molding";
  if (value.includes("sheet") || value.includes("bracket")) return "Sheet metal fabrication";
  if (value.includes("gear")) return "CNC machining";
  return "CNC machining";
}

function materialMultiplierFor(material) {
  const text = String(material || "").toLowerCase();
  if (text.includes("titanium")) return 2.4;
  if (text.includes("stainless")) return 1.55;
  if (text.includes("aluminum")) return 1.1;
  if (text.includes("plastic") || text.includes("abs") || text.includes("pc")) return 0.72;
  return 1;
}

function processMultiplierFor(process) {
  const text = String(process || "").toLowerCase();
  if (text.includes("injection")) return 0.82;
  if (text.includes("pcb")) return 0.65;
  if (text.includes("sheet")) return 0.9;
  return 1.12;
}

function containsEither(haystack, needle) {
  const normalizedNeedle = String(needle || "").toLowerCase();
  return haystack.includes(normalizedNeedle) || normalizedNeedle.includes(haystack);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = { rankSuppliers, inferProcessFromText };
