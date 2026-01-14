const API_BASE = "https://deployment-api.manuel-hanifl.workers.dev";

const APPS = [
  { key: "app-a", name: "App A" },
  { key: "app-b", name: "App B" },
];

const STAGES = [
  { key: "dev", name: "Dev" },
  { key: "prod", name: "Prod" },
];

const tbody = document.getElementById("envTbody");
const logEl = document.getElementById("log");

const kpiApps = document.getElementById("kpiApps");
const kpiStages = document.getElementById("kpiStages");
const kpiHealthy = document.getElementById("kpiHealthy");
const kpiIssues = document.getElementById("kpiIssues");

function nowTime() {
  return new Date().toLocaleTimeString();
}

function log(msg, obj) {
  const stamp = nowTime();
  const line = obj ? `${msg}\n${JSON.stringify(obj, null, 2)}` : msg;
  logEl.textContent = `[${stamp}] ${line}\n\n` + logEl.textContent;
}

function shortSha(sha) {
  if (!sha) return null;
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function badge(status) {
  const raw = (status ?? "—").toString().trim().toUpperCase();

  if (raw === "ACCEPTED" || raw === "DEPLOYING") {
    return `
      <span class="badge">
        <span class="dot wait"></span>
        DEPLOYING
      </span>
    `;
  }

  if (raw === "ERROR" || raw === "ERR") {
    return `
      <span class="badge">
        <span class="dot err"></span>
        ERROR
      </span>
    `;
  }

  return `
    <span class="badge">
      <span class="dot ok"></span>
      ${raw}
    </span>
  `;
}

function rowId(app, env) {
  return `row-${app}-${env}`;
}

async function apiGetStatus(app, env) {
  const url = `${API_BASE}/status?app=${encodeURIComponent(app)}&env=${encodeURIComponent(env)}`;
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiDeploy(app, env) {
  const res = await fetch(`${API_BASE}/deploy`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app, env }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function renderTable() {
  tbody.innerHTML = "";

  for (const app of APPS) {
    for (const stage of STAGES) {
      const tr = document.createElement("tr");
      tr.id = rowId(app.key, stage.key);

      tr.innerHTML = `
        <td>
          <strong>${app.name}</strong>
          <div style="color: rgba(255,255,255,.55); font-size: 12px;">${app.key}</div>
        </td>

        <td>
          ${stage.name}
          <div style="color: rgba(255,255,255,.55); font-size: 12px;">${stage.key}</div>
        </td>

        <td class="col-status">${badge("—")}</td>

        <td class="col-url" style="color: rgba(255,255,255,.55);">—</td>

        <td class="col-commit" style="color: rgba(255,255,255,.55); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
          —
        </td>

        <td class="col-updated" style="color: rgba(255,255,255,.55); font-size: 12px;">
          —
        </td>

        <td class="right">
          <div class="actions">
            <button class="btn btn-primary btn-deploy">Deploy</button>
          </div>
        </td>
      `;

      tr.querySelector(".btn-deploy").addEventListener("click", () => deployOne(app.key, stage.key));

      tbody.appendChild(tr);
    }
  }

  kpiApps.textContent = `${APPS.length}`;
  kpiStages.textContent = `${STAGES.length}`;
}

function setRowBusy(app, env, busy) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;
  tr.querySelector(".btn-deploy").disabled = busy;
  if (busy) tr.querySelector(".col-status").innerHTML = badge("ACCEPTED");
}

function setRowData(app, env, { status, url, commit, message, updatedAt }) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;

  tr.querySelector(".col-status").innerHTML = badge(status);

  const urlCell = tr.querySelector(".col-url");
  if (url) {
    urlCell.innerHTML = `<a href="${url}" target="_blank" rel="noopener">Open</a>
      <div style="color: rgba(255,255,255,.55); font-size:12px;">${url}</div>`;
  } else {
    urlCell.textContent = "—";
  }

  const commitCell = tr.querySelector(".col-commit");
  if (commit) {
    const sha = shortSha(commit);
    commitCell.innerHTML = message
      ? `<span title="${escapeHtml(message)}">${sha}</span>`
      : `${sha}`;
  } else {
    commitCell.textContent = "—";
  }

  tr.querySelector(".col-updated").textContent = updatedAt || "—";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateKpis() {
  let healthy = 0;
  let issues = 0;

  for (const app of APPS) {
    for (const stage of STAGES) {
      const tr = document.getElementById(rowId(app.key, stage.key));
      const label = tr?.querySelector(".badge")?.textContent?.trim() ?? "";
      if (label.includes("OK") || label.includes("DEPLOYED")) healthy++;
      if (label.includes("ERROR")) issues++;
    }
  }

  kpiHealthy.textContent = `${healthy}`;
  kpiIssues.textContent = `${issues}`;
}

async function refreshOne(app, env) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;

  try {
    const data = await apiGetStatus(app, env);

    const url = data?.result?.url ?? null;
    const commit = data?.pages?.commit ?? null;
    const message = data?.pages?.message ?? null;

    const stageStatusRaw = data?.pages?.stageStatus ?? null;
    const stageStatus = stageStatusRaw ? String(stageStatusRaw).toLowerCase() : null;

    const isDeploying =
      stageStatus && ["queued", "in_progress", "building", "initializing"].includes(stageStatus);

    const pagesError = data?.pages?.error ?? null;

    const computedStatus = pagesError
      ? "OK"
      : isDeploying
        ? "DEPLOYING"
        : (data?.status ?? "OK");

    setRowData(app, env, {
      status: computedStatus,
      url,
      commit,
      message,
      updatedAt: nowTime(),
    });

    log(`Status refresh: ${app}/${env}`, data);
  } catch (e) {
    setRowData(app, env, {
      status: "ERROR",
      url: null,
      commit: null,
      message: null,
      updatedAt: nowTime(),
    });
    log(`Status ERROR: ${app}/${env} → ${e.message}`);
  } finally {
    updateKpis();
  }
}

async function refreshAll() {
  log("Refreshing all rows...");
  for (const app of APPS) {
    for (const stage of STAGES) {
      await refreshOne(app.key, stage.key);
    }
  }
}

async function deployOne(app, env) {
  setRowBusy(app, env, true);
  try {
    const data = await apiDeploy(app, env);
    const url = data?.result?.url ?? null;

    setRowData(app, env, {
      status: "DEPLOYING",
      url,
      commit: null,
      message: null,
      updatedAt: nowTime(),
    });

    log(`Deploy request: ${app}/${env}`, data);

    await refreshOne(app, env);
  } catch (e) {
    setRowData(app, env, {
      status: "ERROR",
      url: null,
      commit: null,
      message: null,
      updatedAt: nowTime(),
    });
    log(`Deploy ERROR: ${app}/${env} → ${e.message}`);
  } finally {
    setRowBusy(app, env, false);
    updateKpis();
  }
}

document.getElementById("refreshAll").addEventListener("click", refreshAll);
document.getElementById("clearLog").addEventListener("click", () => {
  logEl.textContent = "Activity cleared.\n";
});
document.getElementById("openApi").addEventListener("click", () => {
  window.open(`${API_BASE}/status?app=app-a&env=dev`, "_blank", "noopener");
});

renderTable();
updateKpis();
log(`Portal loaded from ${location.origin}`);
log(`API_BASE = ${API_BASE}`);

refreshAll();
