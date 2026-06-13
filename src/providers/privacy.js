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

  if (config.terminal3.apiKey && config.terminal3.actionUrl) {
    try {
      const response = await fetch(config.terminal3.actionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.terminal3.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "seal_identity",
          privateRef,
          identity,
          policy: {
            exposeRawAddressToAgents: false,
            allowedPurpose: "manufacturing_sourcing_logistics",
          },
        }),
      });

      if (!response.ok) throw new Error(`Terminal 3 returned ${response.status}`);
      const data = await response.json();
      return {
        ...masked,
        provider: "terminal3",
        sealedReference: data.sealedReference || data.ref || privateRef,
      };
    } catch (error) {
      console.warn(`Terminal 3 sealing failed, using local mask: ${error.message}`);
    }
  }

  return {
    ...masked,
    provider: "local-mask",
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
