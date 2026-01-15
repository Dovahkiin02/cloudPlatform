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

document.getElementById("btnRefresh").addEventListener("click", () => refreshAll());
document.getElementById("btnReloadCommits").addEventListener("click", () => reloadAllCommits());

function nowTime() {
  return new Date().toLocaleTimeString();
}

function log(msg, obj) {
  const stamp = nowTime();
  const line = obj ? `${msg}\n${JSON.stringify(obj, null, 2)}\n` : `${msg}\n`;
  logEl.textContent = `[${stamp}] ${line}\n${logEl.textContent}`.slice(0, 25000);
}

function badge(text) {
  const t = String(text || "—").toUpperCase();
  let cls = "badge";
  if (["OK", "HEALTHY"].includes(t)) cls += " good";
  else if (["ERROR", "FAILED"].includes(t)) cls += " bad";
  else if (["DEPLOYING", "ACCEPTED", "BUILDING"].includes(t)) cls += " warn";
  return `<span class="${cls}">${t}</span>`;
}

function rowId(app, env) {
  return `row-${app}-${env}`;
}

async function apiStatus(app, env) {
  const res = await fetch(`${API_BASE}/status?app=${encodeURIComponent(app)}&env=${encodeURIComponent(env)}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiCommits(app, env, limit = 12) {
  const res = await fetch(
    `${API_BASE}/commits?app=${encodeURIComponent(app)}&env=${encodeURIComponent(env)}&limit=${encodeURIComponent(
      String(limit)
    )}`,
    { credentials: "include" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiDeploy(app, env, commit) {
  const res = await fetch(`${API_BASE}/deploy`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app, env, commit }),
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

        <td class="col-commit">
          <select class="commit-select">
            <option value="">Loading commits…</option>
          </select>
          <div class="commit-current" style="margin-top:6px; color: rgba(255,255,255,.55); font-size:12px;">
            Deployed: —
          </div>
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
  tr.querySelector(".commit-select").disabled = busy;
  if (busy) tr.querySelector(".col-status").innerHTML = badge("ACCEPTED");
}

function getSelectedCommit(app, env) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return null;
  const sel = tr.querySelector(".commit-select");
  return sel?.value || null;
}

function setRowData(app, env, { status, url, deployedCommit, deployedMessage, updatedAt }) {
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

  const commitLabel = deployedCommit ? deployedCommit.slice(0, 7) : "—";
  const msg = deployedMessage ? ` — ${escapeHtml(deployedMessage)}` : "";
  tr.querySelector(".commit-current").innerHTML = `Deployed: <span class="mono">${commitLabel}</span>${msg}`;

  tr.querySelector(".col-updated").textContent = updatedAt || "—";
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadCommitsForRow(app, env) {
  const tr = document.getElementById(rowId(app, env));
  if (!tr) return;

  const select = tr.querySelector(".commit-select");
  select.innerHTML = `<option value="">Loading commits…</option>`;
  select.disabled = true;

  try {
    const data = await apiCommits(app, env, 15);
    const commits = data?.commits || [];

    if (!commits.length) {
      select.innerHTML = `<option value="">No commits found</option>`;
      select.disabled = true;
      return;
    }

    select.innerHTML = commits
      .map((c, idx) => {
        const label = `${c.shortSha} — ${escapeHtml(c.message || "")}`;
        const selected = idx === 0 ? "selected" : "";
        return `<option value="${c.sha}" ${selected}>${label}</option>`;
      })
      .join("");

    select.disabled = false;
  } catch (e) {
    select.innerHTML = `<option value="">Error loading commits</option>`;
    select.disabled = true;
    log(`Commits ERROR: ${app}/${env} → ${e.message}`);
  }
}

async function reloadAllCommits() {
  log("Reloading commit lists…");
  for (const app of APPS) {
    for (const stage of STAGES) {
      await loadCommitsForRow(app.key, stage.key);
    }
  }
  log("Commit lists reloaded.");
}

async function refreshOne(app, env) {
  const data = await apiStatus(app, env);

  const url = data?.result?.url ?? null;
  const deployedCommit = data?.pages?.commit ?? null;
  const deployedMessage = data?.pages?.message ?? null;

  setRowData(app, env, {
    status: data?.pages?.error ? "ERROR" : "OK",
    url,
    deployedCommit,
    deployedMessage,
    updatedAt: nowTime(),
  });

  return data;
}

async function refreshAll() {
  log("Refreshing status for all apps/stages…");
  let healthy = 0;
  let issues = 0;

  for (const app of APPS) {
    for (const stage of STAGES) {
      try {
        const data = await refreshOne(app.key, stage.key);
        if (data?.pages?.error) issues++;
        else healthy++;
      } catch (e) {
        issues++;
        log(`Status ERROR: ${app.key}/${stage.key} → ${e.message}`);
      }
    }
  }

  kpiHealthy.textContent = `${healthy}`;
  kpiIssues.textContent = `${issues}`;
}

async function deployOne(app, env) {
  const commit = getSelectedCommit(app, env);
  if (!commit) {
    log(`Deploy blocked: no commit selected for ${app}/${env}`);
    return;
  }

  setRowBusy(app, env, true);

  try {
    const data = await apiDeploy(app, env, commit);
    log(`Deploy request: ${app}/${env} (commit ${commit.slice(0, 7)})`, data);

    // Immediately show deploying
    setRowData(app, env, {
      status: "DEPLOYING",
      url: data?.result?.url ?? null,
      deployedCommit: null,
      deployedMessage: null,
      updatedAt: nowTime(),
    });

    // Poll status a few times so you can *see* the commit change
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const st = await apiStatus(app, env);
      const deployed = st?.pages?.commit;

      // stop early once Pages reports a commit (and ideally it matches selection)
      if (deployed) {
        setRowData(app, env, {
          status: st?.pages?.error ? "ERROR" : "OK",
          url: st?.result?.url ?? null,
          deployedCommit: st?.pages?.commit ?? null,
          deployedMessage: st?.pages?.message ?? null,
          updatedAt: nowTime(),
        });

        if (String(deployed).startsWith(commit.slice(0, 7)) || deployed === commit) break;
      }
    }
  } catch (e) {
    setRowData(app, env, {
      status: "ERROR",
      url: null,
      deployedCommit: null,
      deployedMessage: e.message,
      updatedAt: nowTime(),
    });
    log(`Deploy ERROR: ${app}/${env} → ${e.message}`);
  } finally {
    setRowBusy(app, env, false);
  }
}

// Init
renderTable();
reloadAllCommits().then(() => refreshAll());
