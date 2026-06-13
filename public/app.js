const form = document.querySelector("#sourceForm");
const fileInput = document.querySelector("#blueprintInput");
const fileState = document.querySelector("#fileState");
const previewImage = document.querySelector("#previewImage");
const submitButton = document.querySelector("#submitButton");
const headerSubmitButton = document.querySelector("#headerSubmitButton");
const healthStatus = document.querySelector("#healthStatus");
const requestId = document.querySelector("#requestId");
const emptyState = document.querySelector("#emptyState");
const results = document.querySelector("#results");
const progressStrip = document.querySelector("#progressStrip");
const searchVisual = document.querySelector("#searchVisual");
const searchSteps = document.querySelector("#searchSteps");
const storeList = document.querySelector("#storeList");
const refreshStoreButton = document.querySelector("#refreshStoreButton");
let apiBase = window.location.protocol === "file:" ? "" : "";
let progressTimer = null;

let selectedFile = null;
let selectedFileBase64 = "";

hydrateFromQuery();
initHealth();
loadDiscoveryStore();

refreshStoreButton?.addEventListener("click", loadDiscoveryStore);

fileInput.addEventListener("change", async (event) => {
  selectedFile = event.target.files[0] || null;
  selectedFileBase64 = "";

  if (!selectedFile) {
    fileState.textContent = "No file selected";
    previewImage.src = "sample-part.svg";
    return;
  }

  fileState.textContent = selectedFile.name;
  selectedFileBase64 = await readFileAsBase64(selectedFile);

  if (selectedFile.type.startsWith("image/")) {
    previewImage.src = `data:${selectedFile.type};base64,${selectedFileBase64}`;
  } else {
    previewImage.src = "sample-part.svg";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoading(true);
  beginVisualSearch();

  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      ...data,
      quantity: Number(data.quantity),
      fileName: selectedFile?.name || "",
      mimeType: selectedFile?.type || "",
      fileBase64: selectedFileBase64,
    };

    const response = await fetchApi("/api/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    const result = await response.json();
    renderResult(result);
    await loadDiscoveryStore();
    finishVisualSearch();
  } catch (error) {
    requestId.textContent = error.message;
    markSearchError(error.message);
  } finally {
    setLoading(false);
  }
});

async function initHealth() {
  for (const candidate of apiBaseCandidates()) {
    try {
      const response = await fetch(`${candidate}/api/health`);
      if (!response.ok) continue;
      apiBase = candidate;
      window.localStorage?.setItem("instasourceApiBase", apiBase);
      const health = await response.json();
      const live = Object.entries(health.providers)
        .filter((entry) => entry[1])
        .map((entry) => entry[0]);
      const warning = health.warnings?.[0] ? ` | ${health.warnings[0]}` : "";
      healthStatus.textContent = live.length ? `Live: ${live.join(", ")}${warning}` : `Mock mode ready${warning}`;
      renderProviderStatus(health.providers);
      return;
    } catch {
      // Try the next candidate.
    }
  }
  healthStatus.textContent = "Start server for analysis";
}

function apiBaseCandidates() {
  if (window.location.protocol !== "file:") return [""];
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("apiBase");
  const saved = window.localStorage?.getItem("instasourceApiBase");
  return [...new Set([
    explicit,
    saved,
    "http://127.0.0.1:4124",
    "http://127.0.0.1:4123",
  ].filter(Boolean))];
}

async function fetchApi(path, options) {
  if (apiBase) {
    return fetch(`${apiBase}${path}`, options);
  }

  let lastError;
  for (const candidate of apiBaseCandidates()) {
    try {
      const response = await fetch(`${candidate}${path}`, options);
      apiBase = candidate;
      window.localStorage?.setItem("instasourceApiBase", apiBase);
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not reach InstaSource API server");
}

function renderResult(result) {
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
  requestId.textContent = compactRequestId(result.requestId);

  document.querySelector("#feasibility").textContent = result.report.feasibility || "-";
  document.querySelector("#costRange").textContent = formatCostRange(result.report.costRangeUsd);
  document.querySelector("#timeline").textContent = formatTimeline(result.report.timelineDays);
  document.querySelector("#confidenceMetric").textContent = `${Math.round((result.specification.confidence || 0) * 100)}%`;
  document.querySelector("#specSource").textContent = result.specification.source || "-";
  document.querySelector("#hsCode").textContent = `HS ${result.logistics.estimatedHsCode || "-"}`;
  document.querySelector("#dutyRate").textContent = `${Math.round((result.logistics.dutyRate || 0) * 1000) / 10}%`;
  document.querySelector("#destinationMetric").textContent = result.logistics.destinationCountry || "-";
  document.querySelector("#privacyProvider").textContent = result.privacy.provider || "-";

  renderDiscovery(result.discovery);
  renderSpec(result.specification);
  renderSuppliers(result.suppliers, result.logistics.destinationCountry);
  renderList("#riskList", result.report.risks || []);
  renderList("#questionList", result.report.questionsForBuyer || []);

  document.querySelector("#privacyNote").textContent =
    `Address hidden from model and supplier discovery. Private reference: ${result.privacy.sealedReference}.`;
}

function renderDiscovery(discovery) {
  if (!discovery) return;
  document.querySelector("#discoveryQuery").textContent = discovery.query || "-";
  document.querySelector("#sourceCount").textContent = String(discovery.sources?.length || 0);
  document.querySelector("#candidateCount").textContent = String(discovery.candidates?.length || 0);
  document.querySelector("#discoveryLink").href = `#discoveryStore`;

  const sourceList = document.querySelector("#sourceList");
  sourceList.innerHTML = "";
  for (const source of discovery.sources || []) {
    const item = document.createElement("a");
    item.className = "source-card";
    item.href = source.url;
    item.target = "_blank";
    item.rel = "noreferrer";
    const title = document.createElement("strong");
    title.textContent = source.title || "Bright Data source";
    const meta = document.createElement("span");
    meta.textContent = `${source.status || "fetched"} | ${source.chars || 0} chars`;
    item.append(title, meta);
    sourceList.append(item);
  }
}

function renderSpec(spec) {
  const specList = document.querySelector("#specList");
  specList.innerHTML = "";
  const rows = [
    ["Part", spec.partName],
    ["Material", spec.material],
    ["Process", spec.process],
    ["Dimensions", spec.dimensions],
    ["Tolerances", spec.tolerances],
    ["Finish", spec.finish],
    ["Quantity", spec.quantity],
    ["Assumptions", (spec.assumptions || []).join("; ")],
  ];

  for (const [label, value] of rows) {
    const tile = document.createElement("div");
    tile.className = "spec-tile";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "-";
    tile.append(dt, dd);
    specList.append(tile);
  }
}

function renderSuppliers(suppliers, destinationCountry) {
  const supplierList = document.querySelector("#supplierList");
  supplierList.innerHTML = "";
  const costs = suppliers.map((supplier) => Number(supplier.estimatedTotalUsd || 0));
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  for (const supplier of suppliers) {
    const card = document.createElement("article");
    card.className = "supplier-card";

    const ring = document.createElement("div");
    ring.className = "score-ring";
    ring.style.setProperty("--score", `${Math.max(0, Math.min(100, supplier.score)) * 3.6}deg`);
    const ringText = document.createElement("span");
    ringText.textContent = supplier.score;
    ring.append(ringText);

    const details = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = supplier.name;
    const location = document.createElement("p");
    location.className = "supplier-location";
    location.textContent = `${supplier.region}, ${supplier.country} to ${destinationCountry || "destination"} | ${(supplier.processes || []).join(", ")}`;
    const chips = document.createElement("div");
    chips.className = "chip-row";
    for (const reason of (supplier.matchReasons || supplier.publicSignals || []).slice(0, 4)) {
      const chip = document.createElement("span");
      chip.textContent = reason;
      chips.append(chip);
    }
    details.append(title, location, chips);

    const cost = document.createElement("div");
    cost.className = "supplier-cost";
    const total = document.createElement("strong");
    total.textContent = money(supplier.estimatedTotalUsd);
    const unit = document.createElement("span");
    unit.textContent = `${money(supplier.estimatedUnitCostUsd)} / unit | ${supplier.estimatedLeadTimeDays} days`;
    const bar = document.createElement("div");
    bar.className = "cost-bar";
    const fill = document.createElement("span");
    fill.style.setProperty("--bar", `${costBarWidth(supplier.estimatedTotalUsd, minCost, maxCost)}%`);
    bar.append(fill);
    cost.append(total, unit, bar);

    card.append(ring, details, cost);
    supplierList.append(card);
  }
}

async function loadDiscoveryStore() {
  if (!storeList) return;
  try {
    const response = await fetchApi("/api/discoveries");
    if (!response.ok) throw new Error(`Store failed: ${response.status}`);
    const data = await response.json();
    renderStoreList(data.discoveries || []);
  } catch {
    storeList.innerHTML = '<p class="store-empty">Discovery store will appear after the API server is reachable.</p>';
  }
}

function renderStoreList(discoveries) {
  storeList.innerHTML = "";
  if (!discoveries.length) {
    storeList.innerHTML = '<p class="store-empty">No Bright Data runs stored yet.</p>';
    return;
  }
  for (const discovery of discoveries.slice(0, 8)) {
    const card = document.createElement("article");
    card.className = "store-card";
    const title = document.createElement("strong");
    title.textContent = discovery.query || "Supplier discovery";
    const meta = document.createElement("span");
    meta.textContent = `${discovery.provider} | ${discovery.sourceCount} sources | ${discovery.candidateCount} candidates`;
    const id = document.createElement("code");
    id.textContent = discovery.requestId ? compactRequestId(discovery.requestId) : discovery.id;
    card.append(title, meta, id);
    storeList.append(card);
  }
}

function renderList(selector, items) {
  const node = document.querySelector(selector);
  node.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : JSON.stringify(item);
    node.append(li);
  }
}

function setLoading(isLoading) {
  for (const button of [submitButton, headerSubmitButton]) {
    if (!button) continue;
    button.disabled = isLoading;
  }
  submitButton.textContent = isLoading ? "Running analysis" : "Run sourcing analysis";
  headerSubmitButton.textContent = isLoading ? "Running" : "Run analysis";
}

function setProgress(step) {
  [...progressStrip.children].forEach((item, index) => {
    item.classList.toggle("active", index < step);
  });
}

function beginVisualSearch() {
  setProgress(1);
  emptyState.classList.remove("hidden");
  results.classList.add("hidden");
  requestId.textContent = "Searching";
  searchVisual?.classList.remove("idle", "error", "complete");
  searchVisual?.classList.add("running");
  let step = 0;
  activateSearchStep(step);
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    step = Math.min(step + 1, 3);
    setProgress(step + 1);
    activateSearchStep(step);
  }, 1400);
}

function finishVisualSearch() {
  clearInterval(progressTimer);
  setProgress(4);
  activateSearchStep(3);
  searchVisual?.classList.remove("running", "error");
  searchVisual?.classList.add("complete");
}

function markSearchError(message) {
  clearInterval(progressTimer);
  searchVisual?.classList.remove("running", "complete");
  searchVisual?.classList.add("error");
  requestId.textContent = message;
}

function activateSearchStep(activeIndex) {
  [...(searchSteps?.children || [])].forEach((item, index) => {
    item.classList.toggle("active", index <= activeIndex);
  });
}

function renderProviderStatus(providers) {
  setProviderText("#visionProvider", providers.senseNova || providers.kimi, providers.senseNova ? "SenseNova live" : "Kimi fallback");
  setProviderText("#brightDataProvider", providers.brightData, "Bright Data key live");
  setProviderText("#daytonaProvider", providers.daytona, "Daytona ready");
  setProviderText("#terminal3Provider", providers.terminal3, "Terminal 3 ready");
}

function setProviderText(selector, isLive, liveText) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = isLive ? liveText : "Not configured";
  node.classList.toggle("provider-off", !isLive);
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of params.entries()) {
    if (!value || name === "blueprint") continue;
    const field = form.elements.namedItem(name);
    if (field && "value" in field) field.value = value;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCostRange(range) {
  if (!range) return "-";
  if (typeof range === "string") return range;
  return `${money(range.low)} - ${money(range.high)}`;
}

function formatTimeline(timeline) {
  if (!timeline) return "-";
  if (typeof timeline === "string") return timeline;
  return `${timeline.fastest}-${timeline.conservative} days`;
}

function compactRequestId(value) {
  if (!value) return "Ready";
  return value.replace("src_", "").slice(0, 8);
}

function costBarWidth(cost, minCost, maxCost) {
  if (maxCost === minCost) return 88;
  const normalized = (Number(cost || 0) - minCost) / (maxCost - minCost);
  return Math.round(88 - normalized * 38);
}
