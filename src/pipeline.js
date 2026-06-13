const crypto = require("crypto");
const { extractSpecification } = require("./providers/vision");
const { discoverSuppliers } = require("./providers/suppliers");
const { generateFeasibilityReport } = require("./providers/analysis");
const { calculateLogistics } = require("./providers/logistics");
const { sealIdentity } = require("./providers/privacy");
const { rankSuppliers } = require("./utils/scoring");

async function runSourcingAnalysis(payload, config) {
  const request = normalizeRequest(payload);
  const requestId = `src_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();

  const privacy = await sealIdentity(
    {
      companyName: request.companyName,
      shippingAddress: request.shippingAddress,
      destinationCountry: request.destinationCountry,
      destinationPostal: request.destinationPostal,
    },
    config
  );

  const spec = await extractSpecification(request, config);
  const supplierCandidates = await discoverSuppliers(spec, request, config);
  const logistics = await calculateLogistics(spec, supplierCandidates, request, privacy, config);
  const rankedSuppliers = rankSuppliers(spec, supplierCandidates, logistics);
  const report = await generateFeasibilityReport(spec, rankedSuppliers, logistics, request, config);

  return {
    requestId,
    createdAt: startedAt,
    status: "completed",
    providerMode: config.hasLiveProviders ? "hybrid-live" : "mock",
    privacy,
    specification: spec,
    suppliers: rankedSuppliers.slice(0, 3),
    allCandidates: rankedSuppliers,
    logistics,
    report,
    nextActions: [
      "Review extracted dimensions and tolerances before supplier outreach.",
      "Ask suppliers for DFM feedback and firm quotation against the generated spec.",
      "Attach NDA, drawing revision, and approved material certifications for production runs.",
    ],
  };
}

function normalizeRequest(payload) {
  const quantity = Number(payload.quantity || 100);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const error = new Error("Quantity must be greater than zero");
    error.statusCode = 400;
    throw error;
  }

  return {
    partName: clean(payload.partName || "Custom manufactured part"),
    quantity,
    materialHint: clean(payload.materialHint || ""),
    processHint: clean(payload.processHint || ""),
    finishHint: clean(payload.finishHint || ""),
    toleranceHint: clean(payload.toleranceHint || ""),
    destinationCountry: clean(payload.destinationCountry || "US").toUpperCase(),
    destinationPostal: clean(payload.destinationPostal || ""),
    companyName: clean(payload.companyName || ""),
    shippingAddress: clean(payload.shippingAddress || ""),
    fileName: clean(payload.fileName || ""),
    mimeType: clean(payload.mimeType || ""),
    fileBase64: cleanBase64(payload.fileBase64 || ""),
  };
}

function clean(value) {
  return String(value).trim().slice(0, 2000);
}

function cleanBase64(value) {
  return String(value).replace(/^data:[^;]+;base64,/, "").trim();
}

module.exports = { runSourcingAnalysis };
