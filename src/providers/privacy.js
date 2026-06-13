const crypto = require("crypto");

async function sealIdentity(identity, config) {
  const privateRef = `priv_${crypto.randomUUID()}`;
  const masked = {
    privateRef,
    companyName: maskCompany(identity.companyName),
    destinationCountry: identity.destinationCountry,
    destinationPostal: maskPostal(identity.destinationPostal),
    addressVisibleToAgents: false,
  };

  return {
    ...masked,
    provider: config.terminal3.apiKey ? "terminal3-adk-ready" : "local-mask",
    sealedReference: privateRef,
  };
}

function maskCompany(companyName) {
  if (!companyName) return "";
  const trimmed = String(companyName).trim();
  if (trimmed.length <= 3) return "***";
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`;
}

function maskPostal(postal) {
  if (!postal) return "";
  const trimmed = String(postal).trim();
  if (trimmed.length <= 3) return "***";
  return `${trimmed.slice(0, 3)}***`;
}

module.exports = { sealIdentity };
