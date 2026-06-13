const fs = require("fs");
const path = require("path");

const storeDir = path.join(__dirname, "..", ".instasource");
const storePath = path.join(storeDir, "discoveries.json");
const discoveries = loadDiscoveries();

function saveDiscovery(discovery) {
  const record = {
    ...discovery,
    updatedAt: new Date().toISOString(),
  };
  const index = discoveries.findIndex((item) => item.id === record.id);
  if (index === -1) discoveries.unshift(record);
  else discoveries[index] = record;
  while (discoveries.length > 40) discoveries.pop();
  persist();
  return record;
}

function listDiscoveries() {
  return discoveries.map((item) => ({
    id: item.id,
    requestId: item.requestId,
    query: item.query,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    provider: item.provider,
    sourceCount: item.sources?.length || 0,
    candidateCount: item.candidates?.length || 0,
    status: item.status,
  }));
}

function getDiscovery(id) {
  return discoveries.find((item) => item.id === id) || null;
}

function loadDiscoveries() {
  try {
    if (!fs.existsSync(storePath)) return [];
    const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function persist() {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(discoveries, null, 2));
}

module.exports = { saveDiscovery, listDiscoveries, getDiscovery };
