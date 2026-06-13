async function calculateLogistics(spec, suppliers, request, privacy, config) {
  const local = calculateLocalLogistics(spec, suppliers, request);

  if (config.daytona.apiKey) {
    local.execution = {
      mode: "daytona-ready",
      note: "DAYTONA_API_KEY is configured. Swap calculateLocalLogistics with Daytona SDK execution for isolated production calculations.",
    };
  } else {
    local.execution = {
      mode: "local-mvp",
      note: "Local deterministic calculator used. Add Daytona credentials for isolated execution.",
    };
  }

  local.privateDestinationRef = privacy.privateRef;
  return local;
}

function calculateLocalLogistics(spec, suppliers, request) {
  const destination = request.destinationCountry || "US";
  const dutyRate = dutyRateFor(spec, destination);
  const currency = destination === "US" ? "USD" : "USD";
  const estimates = {};

  for (const supplier of suppliers) {
    const freight = estimateFreight(supplier, request.quantity, destination);
    const dutyBase = supplier.unitCostBaseUsd * request.quantity;
    const duty = dutyBase * dutyRate;
    estimates[supplier.id] = {
      freightUsd: roundMoney(freight),
      dutyUsd: roundMoney(duty),
      dutyRate,
      currency,
      shippingDays: estimateShippingDays(supplier.country, destination),
    };
  }

  return {
    destinationCountry: destination,
    estimatedHsCode: guessHsCode(spec),
    dutyRate,
    estimates,
    assumptions: [
      "HS code is estimated from part description and must be reviewed by a customs broker.",
      "Freight assumes small-to-mid batch air freight, not ocean freight or dangerous goods.",
      "Currency conversion is fixed to USD in the MVP.",
    ],
  };
}

function dutyRateFor(spec, destination) {
  if (destination !== "US") return 0.045;
  const text = `${spec.material} ${spec.process} ${spec.partName}`.toLowerCase();
  if (text.includes("pcb") || text.includes("circuit")) return 0.0;
  if (text.includes("aluminum")) return 0.035;
  if (text.includes("steel")) return 0.029;
  if (text.includes("plastic")) return 0.04;
  return 0.032;
}

function estimateFreight(supplier, quantity, destination) {
  const distanceMultiplier = supplier.country === destination ? 0.45 : 1;
  const batchMultiplier = Math.max(1, Math.sqrt(quantity / 100));
  return (supplier.shippingBaseUsd || 240) * distanceMultiplier * batchMultiplier;
}

function estimateShippingDays(originCountry, destinationCountry) {
  if (originCountry === destinationCountry) return 4;
  if (originCountry === "US" && destinationCountry === "US") return 3;
  if (originCountry === "Mexico" && destinationCountry === "US") return 6;
  if (originCountry === "China" && destinationCountry === "US") return 9;
  return 11;
}

function guessHsCode(spec) {
  const text = `${spec.partName} ${spec.material} ${spec.process}`.toLowerCase();
  if (text.includes("pcb") || text.includes("circuit")) return "8534.00";
  if (text.includes("gear")) return "8483.40";
  if (text.includes("aluminum")) return "7616.99";
  if (text.includes("plastic")) return "3926.90";
  return "8479.90";
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = { calculateLogistics };
