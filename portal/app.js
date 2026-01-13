// --- CONFIG ---
const API_BASE = "https://deployment-api.manuel-hanifl.workers.dev"; // no trailing slash
const PORTAL_ORIGIN = location.origin;

// Apps + stages you want to show
const APPS = [
  { key: "app-a", name: "App A" },
  { key: "app-b", name: "App B" },
];

// Stages are "logical" for now (tomorrow you can map dev/prod to branches)
const STAGES = [
  { key: "dev", name: "Dev" },
  { key: "prod", name: "Prod" },
];

const tbody = document.getElementById("envTbody");
const logEl = document.getElementById("log");

const kpiApps = document.getElementById("kpiApps");
const kpiStages = document.getElementById("kpiStages");
const kpiOk = document.getElementById("kpiOk");
const kpiErr = document.getElementById("kpiErr");

function log(msg, obj) {
  const stamp = new Date().toLocaleTimeString();
  const line = obj ? `${msg}\n${JSON.stringify(obj, null, 2)}` : msg;
  logEl.textContent = `[${stamp}] ${line}\n\n` + logEl.textContent;
}

function badge(status) {
  // status values you return: OK / ACCEPTED / errors
  let cls = "wait";
  let label = status ?? "—";
  if (label === "OK") cls = "ok";
  if (label === "ERROR" || label === "ERR") cls = "err";
  if (label === "ACCEPTED") cls = "wait";

  return `
    <span class="badge">
      <span class="dot ${cls}"></span>
      ${label}
    </span>
  `;
}

async function apiGetStatus(app, env) {
  const url = `${API_BASE}/status?app=${encodeURIComponent(app)}&env=${encodeURIComponent(env)}`;
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
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

  if (!res.ok && res.status !== 202) {
    const err = data?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  await refreshOne(app, env);
  return data;
}

function rowId(app, env) {
  return `row-${app}-${env}`;
}

function renderTable() {
  tbody.innerHTML = "";

  for (const app of APPS) {
    for (const stage of STAGES) {
      const id = rowId(app.key, stage.key);
      const tr = document.createElement("tr");
      tr.id = id;

      tr.innerHTML = `
        <td><strong>${app.name}</strong><div style="color: rgba(255,255,255,.55); font-size: 12px;">${app.key}</div></td>
        <td>${stage.name}<div style="color: rgba(255,255,255,.55); font-size: 12px;">${stage.key}</div></td>
        <td class="col-status">${badge("—")}</td>
        <td class="col-url" style="color: rgba(255,255,255,.55);">—</td>
        <td class="right">
          <div class="actions">
            <button class="btn btn-secondary btn-status">Status</button>
            <button class="btn btn-primary btn-deploy">Deploy</button>
          </div>
        </td>
      `;

      tr.querySelector(".btn-status").addEventListener("click", () => refreshOne(app.key, stage.key));
      tr.querySelector(".btn-deploy").addEventListener("click", () => deployOne(app.key, stage.key));

      tbody.appendChild(tr);
    }
  }

  kpiApps.textContent = `${APPS.length}`;
  kpiStages.textContent = `${STAGES.length}`;
}

function setRowLoading(app, env, isLoading) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;
  for (const btn of tr.querySelectorAll("button")) btn.disabled = isLoading;
  const statusCell = tr.querySelector(".col-status");
  if (isLoading) statusCell.innerHTML = badge("ACCEPTED");
}

function setRowStatus(app, env, status, url) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;
  tr.querySelector(".col-status").innerHTML = badge(status);
  const urlCell = tr.querySelector(".col-url");

  if (url) {
    urlCell.innerHTML = `<a href="${url}" target="_blank" rel="noopener">Open</a><div style="color: rgba(255,255,255,.55); font-size:12px;">${url}</div>`;
  } else {
    urlCell.textContent = "—";
  }
}

async function refreshOne(app, env) {
  setRowLoading(app, env, true);
  try {
    const data = await apiGetStatus(app, env);
    const url = data?.result?.url ?? null;
    setRowStatus(app, env, data?.status ?? "OK", url);
    log(`Status: ${app}/${env}`, data);
  } catch (e) {
    setRowStatus(app, env, "ERROR", null);
    log(`Status ERROR: ${app}/${env} → ${e.message}`);
  } finally {
    setRowLoading(app, env, false);
    updateKpis();
  }
}

async function deployOne(app, env) {
  setRowLoading(app, env, true);
  try {
    const data = await apiDeploy(app, env);
    const url = data?.result?.url ?? null;
    setRowStatus(app, env, data?.status ?? "ACCEPTED", url);
    log(`Deploy: ${app}/${env}`, data);
  } catch (e) {
    setRowStatus(app, env, "ERROR", null);
    log(`Deploy ERROR: ${app}/${env} → ${e.message}`);
  } finally {
    setRowLoading(app, env, false);
    updateKpis();
  }
}

async function refreshAll() {
  log("Refreshing all environments...");
  // run sequentially to keep logs readable
  for (const app of APPS) {
    for (const stage of STAGES) {
      await refreshOne(app.key, stage.key);
    }
  }
}

function updateKpis() {
  let ok = 0;
  let err = 0;
  for (const app of APPS) {
    for (const stage of STAGES) {
      const tr = document.getElementById(rowId(app.key, stage.key));
      const statusText = tr?.querySelector(".badge")?.textContent?.trim() ?? "";
      if (statusText.includes("OK")) ok++;
      if (statusText.includes("ERROR")) err++;
    }
  }
  kpiOk.textContent = `${ok}`;
  kpiErr.textContent = `${err}`;
}

// Buttons
document.getElementById("refreshAll").addEventListener("click", refreshAll);
document.getElementById("openApi").addEventListener("click", () => {
  window.open(`${API_BASE}/status?app=app-a&env=dev`, "_blank", "noopener");
});

// Init
renderTable();
updateKpis();
log(`Portal loaded from ${PORTAL_ORIGIN}`);
log(`API_BASE = ${API_BASE}`);
