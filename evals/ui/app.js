const SUITE_META = {
  agent: {
    title: "Agent full",
    copy: "All main-agent tests across the selected rows.",
    matrix: true,
  },
  "agent-smoke": {
    title: "Agent smoke",
    copy: "One cheap smoke case across the selected rows.",
    matrix: true,
  },
  "agent-embedding": {
    title: "Agent embedding full",
    copy: "Same matrix, but embedding-backed retrieval is emphasized.",
    matrix: true,
  },
  "agent-embedding-smoke": {
    title: "Agent embedding smoke",
    copy: "One embedding-focused smoke case across the selected rows.",
    matrix: true,
  },
  "agent-hybrid": {
    title: "Agent hybrid full",
    copy: "Same matrix, but hybrid retrieval is emphasized.",
    matrix: true,
  },
  "agent-hybrid-smoke": {
    title: "Agent hybrid smoke",
    copy: "One hybrid-focused smoke case across the selected rows.",
    matrix: true,
  },
  "agent-scouts": {
    title: "Scout matrix",
    copy: "Compare scout presets against the main-agent flow.",
    matrix: true,
  },
  "agent-scouts-smoke": {
    title: "Scout smoke",
    copy: "Check one scout path cheaply before a full run.",
    matrix: true,
  },
  edit: {
    title: "Edit full",
    copy: "Full edit benchmark against the staged workspace.",
    matrix: true,
  },
  "edit-smoke": {
    title: "Edit smoke",
    copy: "One edit task for the selected rows.",
    matrix: true,
  },
  tool: {
    title: "Tool core",
    copy: "Deterministic FreeContext MCP correctness across the standard tool set.",
    matrix: false,
  },
  "tool-fulltext": {
    title: "Tool fulltext",
    copy: "Fulltext-only retrieval checks.",
    matrix: false,
  },
  "tool-fulltext-smoke": {
    title: "Tool fulltext smoke",
    copy: "One fulltext retrieval case.",
    matrix: false,
  },
  "tool-embedding": {
    title: "Tool embedding",
    copy: "Embedding-only retrieval checks against the embed-enabled server.",
    matrix: false,
  },
  "tool-embedding-smoke": {
    title: "Tool embedding smoke",
    copy: "One embedding retrieval case.",
    matrix: false,
  },
  "tool-hybrid": {
    title: "Tool hybrid",
    copy: "Hybrid retrieval checks against the embed-enabled server.",
    matrix: false,
  },
  "tool-hybrid-smoke": {
    title: "Tool hybrid smoke",
    copy: "One hybrid retrieval case.",
    matrix: false,
  },
  "tool-embed-health": {
    title: "Embed-enabled health",
    copy: "Quick check that embedding-enabled tool search is alive.",
    matrix: false,
  },
};

const SCOUT_MODEL_BY_PRESET = {
  "qwen-27b": "qwen/qwen3.5-27b",
  "minimax-2.5": "minimax/minimax-m2.5",
  "stepfun-3.5-flash": "stepfun/step-3.5-flash",
  "grok-4.1-fast": "x-ai/grok-4.1-fast",
  "nemotron-super": "nvidia/nemotron-3-super-120b-a12b",
};

const state = {
  config: null,
  labels: null,
  selectedRows: new Set(),
  activeView: "run",
  runsSignature: "",
};

const LEGACY_SUITE_MAP = {
  semantic: "tool-embedding",
  "semantic-smoke": "tool-embedding-smoke",
  "tool-embed-smoke": "tool-embed-health",
  "agent-semantic": "agent-embedding",
  "agent-semantic-smoke": "agent-embedding-smoke",
};

function byId(id) {
  return document.getElementById(id);
}

function normalizeSuiteName(suite = "agent") {
  return LEGACY_SUITE_MAP[suite] ?? suite;
}

function fetchJson(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? `Request failed: ${response.status}`);
    }
    return data;
  });
}

function setActiveView(view) {
  state.activeView = view;
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  byId("routing-panel")?.classList.toggle("active", view === "routing");
  byId("run-panel")?.classList.toggle("active", view === "run");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilterFromSelection(selectedRows) {
  if (selectedRows.length === 0) {
    return "";
  }
  if (selectedRows.length === 1) {
    return `^${escapeRegex(selectedRows[0])}$`;
  }
  return `^(${selectedRows.map((row) => escapeRegex(row)).join("|")})$`;
}

function providerRowsFromLabels(labels) {
  const matrix = labels?.matrix ?? {};
  return [
    {
      key: "anthropic",
      name: "Anthropic",
      rows: [
        {
          key: "defaultTools",
          title: "default tools",
          badges: ["base"],
          label: matrix.anthropic?.defaultTools,
        },
        {
          key: "defaultToolsFreecontext",
          title: "default tools + FreeContext",
          badges: ["base", "fc"],
          label: matrix.anthropic?.defaultToolsFreecontext,
        },
        {
          key: "scoutDefaultToolsFreecontext",
          title: "scout + default tools + FreeContext",
          badges: ["scout", "base", "fc"],
          label: matrix.anthropic?.scoutDefaultToolsFreecontext,
        },
      ].filter((row) => row.label),
    },
    {
      key: "openai",
      name: "OpenAI",
      rows: [
        {
          key: "defaultTools",
          title: "default tools",
          badges: ["base"],
          label: matrix.openai?.defaultTools,
        },
        {
          key: "defaultToolsFreecontext",
          title: "default tools + FreeContext",
          badges: ["base", "fc"],
          label: matrix.openai?.defaultToolsFreecontext,
        },
        {
          key: "scoutDefaultToolsFreecontext",
          title: "scout + default tools + FreeContext",
          badges: ["scout", "base", "fc"],
          label: matrix.openai?.scoutDefaultToolsFreecontext,
        },
      ].filter((row) => row.label),
    },
  ];
}

function loadForm(config) {
  byId("anthropic-model").value = config.anthropic.model;
  byId("anthropic-proxy-url").value = config.anthropic.proxyUrl;
  byId("anthropic-proxy-token").value = config.anthropic.proxyToken;
  byId("anthropic-direct-url").value = config.anthropic.directBaseUrl;
  byId("anthropic-direct-key").value = config.anthropic.directApiKey;

  byId("openai-model").value = config.openai.model;
  byId("openai-proxy-url").value = config.openai.proxyUrl;
  byId("openai-proxy-token").value = config.openai.proxyToken;
  byId("openai-direct-url").value = config.openai.directBaseUrl;
  byId("openai-direct-key").value = config.openai.directApiKey;

  byId("scout-preset").value = config.scout.preset;
  byId("scout-api-key").value = config.scout.apiKey;
  byId("scout-base-url").value = config.scout.baseUrl;
  byId("scout-local-key").value = config.scout.localApiKey;
  syncScoutModelDisplay(config.scout.preset, config.scout.model);

  byId("run-group").value = config.run.group;
  byId("run-target-filter").value = config.run.targetFilter;
  byId("run-test-filter").value = config.run.testFilter;
  byId("run-output-file").value = config.run.outputFile;

  setActiveBaseRoute("anthropic", config.anthropic.route);
  setActiveBaseRoute("openai", config.openai.route);
  setScoutSource(config.scout.source);
  setActiveSuite(config.run.suite);
}

function readForm() {
  return {
    anthropic: {
      route: activeBaseRoute("anthropic"),
      model: byId("anthropic-model").value,
      proxyUrl: byId("anthropic-proxy-url").value,
      proxyToken: byId("anthropic-proxy-token").value,
      directBaseUrl: byId("anthropic-direct-url").value,
      directApiKey: byId("anthropic-direct-key").value,
    },
    openai: {
      route: activeBaseRoute("openai"),
      model: byId("openai-model").value,
      proxyUrl: byId("openai-proxy-url").value,
      proxyToken: byId("openai-proxy-token").value,
      directBaseUrl: byId("openai-direct-url").value,
      directApiKey: byId("openai-direct-key").value,
    },
    scout: {
      source: activeScoutSource(),
      preset: byId("scout-preset").value,
      apiKey: byId("scout-api-key").value,
      baseUrl: byId("scout-base-url").value,
      model: resolveScoutModel(),
      localApiKey: byId("scout-local-key").value,
    },
    run: {
      suite: activeSuite(),
      group: byId("run-group").value,
      targetFilter: byId("run-target-filter").value,
      testFilter: byId("run-test-filter").value,
      outputFile: byId("run-output-file").value,
    },
  };
}

function activeBaseRoute(provider) {
  return document.querySelector(`.route-tab[data-provider="${provider}"].active`)?.dataset.route ?? "proxy";
}

function setActiveBaseRoute(provider, route) {
  document.querySelectorAll(`.route-tab[data-provider="${provider}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.route === route);
  });
  document.querySelectorAll(`.${provider}-proxy`).forEach((field) => {
    field.classList.toggle("hidden", route !== "proxy");
  });
  document.querySelectorAll(`.${provider}-direct`).forEach((field) => {
    field.classList.toggle("hidden", route !== "direct");
  });
  renderRoutingSummary();
}

function activeScoutSource() {
  return document.querySelector(`.route-tab[data-scout-source].active`)?.dataset.scoutSource ?? "openrouter";
}

function setScoutSource(source) {
  document.querySelectorAll(".route-tab[data-scout-source]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scoutSource === source);
  });
  document.querySelectorAll(".scout-openrouter").forEach((field) => {
    field.classList.toggle("hidden", source !== "openrouter");
  });
  document.querySelectorAll(".scout-openai-compatible").forEach((field) => {
    field.classList.toggle("hidden", source !== "openai-compatible");
  });
  syncScoutModelDisplay();
  renderRoutingSummary();
}

function resolveScoutModel() {
  const preset = byId("scout-preset").value;
  return SCOUT_MODEL_BY_PRESET[preset] ?? "qwen/qwen3.5-27b";
}

function syncScoutModelDisplay(preset = byId("scout-preset").value, explicitModel = "") {
  const model = explicitModel || SCOUT_MODEL_BY_PRESET[preset] || "qwen/qwen3.5-27b";
  const display = byId("scout-model-display");
  if (display) {
    display.value = model;
  }
}

function activeSuite() {
  return normalizeSuiteName(document.querySelector(".suite-tile.active")?.dataset.suite ?? "agent");
}

function setActiveSuite(suite) {
  const normalizedSuite = normalizeSuiteName(suite);
  document.querySelectorAll(".suite-tile").forEach((button) => {
    button.classList.toggle("active", button.dataset.suite === normalizedSuite);
  });
  const meta = SUITE_META[normalizedSuite] ?? SUITE_META.agent;
  const subtitle = byId("run-eval-subtitle");
  if (subtitle) {
    subtitle.textContent = meta.matrix
      ? "Select a suite, click the rows you want, then run. Use the advanced filter only if the matrix does not cover your case."
      : "This suite does not need row selection. Leave the matrix alone and just run it.";
  }
  byId("matrix").style.opacity = meta.matrix ? "1" : "0.45";
  byId("matrix").style.pointerEvents = meta.matrix ? "auto" : "none";
}

function renderRoutingSummary() {
  const anthropicRoute = activeBaseRoute("anthropic");
  const openaiRoute = activeBaseRoute("openai");
  const scoutSource = activeScoutSource();
  const anthropicModel = byId("anthropic-model").value || "(unset)";
  const openaiModel = byId("openai-model").value || "(unset)";
  const anthropicUrl =
    anthropicRoute === "proxy" ? byId("anthropic-proxy-url").value : byId("anthropic-direct-url").value;
  const openaiUrl =
    openaiRoute === "proxy" ? byId("openai-proxy-url").value : byId("openai-direct-url").value;
  const scoutPreset = byId("scout-preset").value;
  const scoutBaseUrl = byId("scout-base-url").value;
  const scoutModel = resolveScoutModel();

  byId("base-routing-summary").textContent =
    `Anthropic: ${anthropicModel} via ${anthropicRoute} ${anthropicUrl ? `at ${anthropicUrl}` : ""}. OpenAI: ${openaiModel} via ${openaiRoute} ${openaiUrl ? `at ${openaiUrl}` : ""}.`;

  byId("scout-routing-summary").textContent =
    scoutSource === "openrouter"
      ? `Scout uses the remote preset registry. Current preset: ${scoutPreset}.`
      : `Scout uses an OpenAI-compatible endpoint. Model: ${scoutModel}${scoutBaseUrl ? ` at ${scoutBaseUrl}` : ""}.`;
}

function renderSuiteStrip() {
  const root = byId("suite-strip");
  root.innerHTML = "";
  for (const [suite, meta] of Object.entries(SUITE_META)) {
    const button = document.createElement("button");
    button.className = "suite-tile";
    button.dataset.suite = suite;
    button.innerHTML = `
      <div class="suite-title">${meta.title}</div>
      <div class="suite-copy">${meta.copy}</div>
    `;
    button.addEventListener("click", () => {
      setActiveSuite(suite);
    });
    root.appendChild(button);
  }
}

function updateRunGroupFromSelection() {
  const rows = [...state.selectedRows];
  if (rows.length === 0) {
    return;
  }
  const groups = new Set(rows.map((row) => (row.startsWith("anthropic-") ? "anthropic" : row.startsWith("openai-") ? "openai" : "all")));
  byId("run-group").value = groups.size === 1 ? [...groups][0] : "all";
}

function renderSelection() {
  const selectedRows = [...state.selectedRows];
  const selectionList = byId("selection-list");
  selectionList.innerHTML = "";
  for (const row of selectedRows) {
    const pill = document.createElement("div");
    pill.className = "selection-pill";
    pill.innerHTML = `<span>${row}</span><button type="button" aria-label="Remove ${row}">×</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      state.selectedRows.delete(row);
      syncComputedFilter();
      renderMatrix();
      renderSelection();
    });
    selectionList.appendChild(pill);
  }
  if (selectedRows.length === 0) {
    selectionList.innerHTML = `<span class="muted">No row chips selected yet. You can still use the advanced filter field.</span>`;
  }
}

function syncComputedFilter() {
  const computed = buildFilterFromSelection([...state.selectedRows]);
  byId("computed-filter").textContent = computed || "(none)";
  if (!byId("run-target-filter").value.trim()) {
    byId("run-target-filter").placeholder = computed || "Leave blank to use the selected rows above";
  }
  updateRunGroupFromSelection();
}

function renderMatrix() {
  const root = byId("matrix");
  root.innerHTML = "";
  for (const provider of providerRowsFromLabels(state.labels)) {
    const card = document.createElement("section");
    card.className = "provider-card";
    const modelPreview = provider.rows[0]?.label?.split("-").slice(1, -1).join("-") ?? "";
    card.innerHTML = `
      <h3>${provider.name}</h3>
      <div class="provider-meta">${modelPreview}</div>
      <div class="provider-rows"></div>
    `;
    const rowsRoot = card.querySelector(".provider-rows");

    for (const row of provider.rows) {
      const selected = state.selectedRows.has(row.label);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `row-card${selected ? " active" : ""}`;
      button.innerHTML = `
        <div class="row-title">
          <span>${row.title}</span>
          <span>${selected ? "Selected" : "Select"}</span>
        </div>
        <div class="row-badges">
          ${row.badges.map((badge) => `<span class="badge ${badge}">${badge === "fc" ? "FreeContext" : badge === "scout" ? "Scout" : "Base"}</span>`).join("")}
        </div>
        <div class="row-label">${row.label}</div>
      `;
      button.addEventListener("click", () => {
        if (state.selectedRows.has(row.label)) {
          state.selectedRows.delete(row.label);
        } else {
          state.selectedRows.add(row.label);
        }
        syncComputedFilter();
        renderMatrix();
        renderSelection();
      });
      rowsRoot.appendChild(button);
    }

    root.appendChild(card);
  }
}

function renderRuns(runs) {
  const root = byId("runs");
  const nextSignature = JSON.stringify(
    runs.map((run) => ({
      id: run.id,
      status: run.status,
      exitCode: run.exitCode,
      finishedAt: run.finishedAt,
      logsLength: run.logs?.length ?? 0,
    })),
  );
  if (state.runsSignature === nextSignature) {
    return;
  }

  const pageScrollY = window.scrollY;
  const runScrollById = new Map();
  root.querySelectorAll(".run").forEach((node) => {
    const runId = node.dataset.runId;
    const logsNode = node.querySelector(".logs");
    if (runId && logsNode) {
      runScrollById.set(runId, logsNode.scrollTop);
    }
  });

  root.innerHTML = "";
  for (const run of runs) {
    const container = document.createElement("div");
    container.className = "run";
    container.dataset.runId = run.id;
    container.innerHTML = `
      <div class="run-top">
        <strong>${SUITE_META[normalizeSuiteName(run.suite)]?.title ?? run.suite}</strong>
        <span class="run-status ${run.status}">${run.status}</span>
      </div>
      <div class="muted">${run.startedAt}</div>
      <div class="muted" style="margin-top:6px;">${run.command}</div>
      <div class="muted" style="margin-top:4px;">Output: ${run.outputFile}</div>
      <div class="logs">${run.logs || ""}</div>
    `;
    root.appendChild(container);

    const previousScroll = runScrollById.get(run.id);
    const logsNode = container.querySelector(".logs");
    if (logsNode && previousScroll !== undefined) {
      logsNode.scrollTop = previousScroll;
    }
  }
  state.runsSignature = nextSignature;
  window.scrollTo({ top: pageScrollY });
}

function applyQuickAction(action) {
  const matrix = state.labels?.matrix ?? {};
  const selections = {
    "anthropic-all": [
      matrix.anthropic?.defaultTools,
      matrix.anthropic?.defaultToolsFreecontext,
      matrix.anthropic?.scoutDefaultToolsFreecontext,
    ],
    "openai-all": [
      matrix.openai?.defaultTools,
      matrix.openai?.defaultToolsFreecontext,
      matrix.openai?.scoutDefaultToolsFreecontext,
    ],
    "all-base": [matrix.anthropic?.defaultTools, matrix.openai?.defaultTools],
    "all-freecontext": [
      matrix.anthropic?.defaultToolsFreecontext,
      matrix.openai?.defaultToolsFreecontext,
    ],
    clear: [],
  };
  state.selectedRows = new Set((selections[action] ?? []).filter(Boolean));
  syncComputedFilter();
  renderMatrix();
  renderSelection();
}

function currentRunRequest() {
  const form = readForm();
  const selectedFilter = buildFilterFromSelection([...state.selectedRows]);
  const manualFilter = form.run.targetFilter.trim();
  return {
    suite: form.run.suite,
    group: form.run.group,
    targetFilter: manualFilter || selectedFilter,
    testFilter: form.run.testFilter,
    outputFile: form.run.outputFile,
  };
}

async function refresh() {
  const [{ config, labels }, { runs }] = await Promise.all([
    fetchJson("/api/config"),
    fetchJson("/api/runs"),
  ]);
  state.config = config;
  state.labels = labels;
  renderSuiteStrip();
  loadForm(config);
  setActiveSuite(config.run.suite);
  renderRoutingSummary();
  renderMatrix();
  renderSelection();
  syncComputedFilter();
  renderRuns(runs);
  setActiveView(state.activeView);
}

document.querySelectorAll(".view-tab").forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});

document.querySelectorAll(".route-tab[data-provider]").forEach((button) => {
  button.addEventListener("click", () => {
    setActiveBaseRoute(button.dataset.provider, button.dataset.route);
  });
});

document.querySelectorAll(".route-tab[data-scout-source]").forEach((button) => {
  button.addEventListener("click", () => {
    setScoutSource(button.dataset.scoutSource);
  });
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => applyQuickAction(button.dataset.action));
});

[
  "anthropic-model",
  "anthropic-proxy-url",
  "anthropic-direct-url",
  "openai-model",
  "openai-proxy-url",
  "openai-direct-url",
  "scout-preset",
  "scout-base-url",
].forEach((id) => {
  byId(id)?.addEventListener("input", () => renderRoutingSummary());
  byId(id)?.addEventListener("change", () => renderRoutingSummary());
});

byId("scout-preset")?.addEventListener("change", () => {
  syncScoutModelDisplay();
  renderRoutingSummary();
});

byId("save-config").addEventListener("click", async () => {
  const { config, labels } = await fetchJson("/api/config", {
    method: "POST",
    body: JSON.stringify(readForm()),
  });
  state.config = config;
  state.labels = labels;
  renderRoutingSummary();
  renderMatrix();
  renderSelection();
  syncComputedFilter();
  setActiveView("run");
});

byId("load-defaults").addEventListener("click", async () => {
  const { config, labels } = await fetchJson("/api/config/defaults", {
    method: "POST",
  });
  state.config = config;
  state.labels = labels;
  state.selectedRows = new Set();
  loadForm(config);
  renderRoutingSummary();
  renderMatrix();
  renderSelection();
  syncComputedFilter();
});

byId("run-eval").addEventListener("click", async () => {
  const form = readForm();
  const request = currentRunRequest();
  await fetchJson("/api/config", {
    method: "POST",
    body: JSON.stringify(form),
  });
  await fetchJson("/api/run", {
    method: "POST",
    body: JSON.stringify(request),
  });
  await refresh();
});

byId("run-target-filter").addEventListener("input", () => {
  const manual = byId("run-target-filter").value.trim();
  byId("computed-filter").textContent = manual || buildFilterFromSelection([...state.selectedRows]) || "(none)";
});

setInterval(() => {
  fetchJson("/api/runs").then(({ runs }) => renderRuns(runs)).catch(() => {});
}, 3000);

refresh().catch((error) => {
  byId("runs").textContent = String(error);
});
