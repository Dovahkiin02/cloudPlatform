const API_BASE = "https://deployment-api.manuel-hanifl.workers.dev"; // your Worker URL

const APPS = [
  { id: "app-a", name: "app-a", devUrl: "https://cloudplatform-2ok.pages.dev", prodUrl: "https://cloudplatform-2ok.pages.dev" },
  { id: "app-b", name: "app-b", devUrl: "https://app-b.pages.dev", prodUrl: "https://app-b.pages.dev" },
];

const shaRe = /^[0-9a-f]{7,40}$/i;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shortSha(sha) { return (sha || "").slice(0, 7); }
function fmtTime(iso) { if (!iso) return "—"; return new Date(iso).toLocaleString(); }

function statusDot(pending, stageStatus) {
  const st = String(stageStatus || "").toLowerCase();

  if (pending) return "warn";

  if (["queued", "building", "deploying", "initializing", "running"].includes(st)) return "warn";
  if (["failure", "failed", "error"].includes(st)) return "bad";

  if (st === "success") return "ok";

  return "warn";
}

function isReady(statusObj, pendingObj) {
  if (pendingObj) return false;
  const st = String(statusObj?.pages?.stageStatus || "").toLowerCase();
  return st === "success";
}

function setRefreshing(on) {
  const topbar = document.getElementById("topbar");
  if (!topbar) return;
  topbar.classList.toggle("active", !!on);

  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("refreshing", !!on));
}

async function runWithRefreshing(fn) {
  setRefreshing(true);
  try {
    await fn();
  } finally {
    setRefreshing(false);
  }
}

function setApiError(msg) {
  $("apiErr").textContent = msg ? `API: ${msg}` : "";
}

function clearLog() {
  const log = $("log");
  log.dataset.empty = "true";
  log.innerHTML = `<div class="tiny" id="emptyLog">No activity yet.</div>`;
}

function ensureLogNotEmpty() {
  const log = $("log");
  if (log.dataset.empty === "true") {
    log.dataset.empty = "false";
    const empty = document.getElementById("emptyLog");
    if (empty) empty.remove();
  }
}

function logItem(title, details) {
  ensureLogNotEmpty();

  const el = document.createElement("div");
  el.className = "logItem";
  el.innerHTML = `
    <div class="row">
      <div class="title">${title}</div>
      <div class="tiny mono">${new Date().toLocaleTimeString()}</div>
    </div>
    <div class="tiny" style="margin-top:6px;">${details}</div>
  `;
  $("log").prepend(el);
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const state = {
  status: { "app-a": { dev: null, prod: null }, "app-b": { dev: null, prod: null } },
  pending: { "app-a": { dev: null, prod: null }, "app-b": { dev: null, prod: null } },
  commitsCache: { dev: [], prod: [] },
};

function renderApps() {
  const root = $("apps");
  root.innerHTML = "";

  for (const app of APPS) {
    const card = document.createElement("div");
    card.className = "card";
    card.style.boxShadow = "none";
    card.style.background = "rgba(255,255,255,0.04)";
    card.style.borderRadius = "16px";
    card.style.marginBottom = "12px";
    const prodStatus = state.status?.[app.id]?.prod;
    const prodPending = state.pending?.[app.id]?.prod;
    const canVisit = isReady(prodStatus, prodPending);

    const visitLabel = canVisit ? "Open" : "Open (deploying)";
    const visitTitle = canVisit ? "Open deployed production page" : "Not ready yet (deployment running)";

    const hd = document.createElement("div");
    hd.className = "hd";
    hd.innerHTML = `
<a class="btnlink ${canVisit ? "" : "disabled"}"
   ${canVisit ? `href="${app.prodUrl}"` : ""}
   target="_blank" rel="noopener"
   aria-disabled="${canVisit ? "false" : "true"}"
   title="${visitTitle}">
  ${visitLabel}
</a>
    `;

    const bd = document.createElement("div");
    bd.className = "bd";
    bd.appendChild(renderEnvRow(app.id, "dev", app.devUrl));
    bd.appendChild(renderEnvRow(app.id, "prod", app.prodUrl));

    card.appendChild(hd);
    card.appendChild(bd);
    root.appendChild(card);
  }

  root.querySelectorAll("[data-refresh]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const appId = btn.getAttribute("data-refresh");
      btn.disabled = true;
      try {
        await runWithRefreshing(async () => {
          await refreshOne(appId, "dev");
          await refreshOne(appId, "prod");
          renderApps();
        });
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderEnvRow(appId, envName, url) {
  const s = state.status?.[appId]?.[envName];
  const p = state.pending?.[appId]?.[envName];

  const commit = s?.pages?.commit || null;
  const stageStatus = s?.pages?.stageStatus || null;
  const canVisitEnv = isReady(s, p);
  const visitEnvTitle = canVisitEnv
    ? "Open deployment (ready)"
    : "Not ready yet (deployment running)";

  const shownCommit = p?.commit ? p.commit : commit;
  const dot = statusDot(!!p, stageStatus);

  const row = document.createElement("div");
  row.className = "row";
  row.style.alignItems = "flex-start";

  row.innerHTML = `
    <div style="min-width: 0;">
      <div class="row" style="justify-content:flex-start; gap:10px;">
        <span class="tag">
          <span class="dot ${dot}"></span>
          <span class="mono">${envName}</span>
        </span>
        <span class="tag mono">${shownCommit ? shortSha(shownCommit) : "—"}</span>
${s?.pages?.deploymentUrl ? `
  <a class="btnlink ${canVisitEnv ? "" : "disabled"}"
     ${canVisitEnv ? `href="${s.pages.deploymentUrl}"` : ""}
     target="_blank" rel="noopener"
     aria-disabled="${canVisitEnv ? "false" : "true"}"
     title="${visitEnvTitle}">
    Visit Page
  </a>
` : ``}
      </div>
      <div class="tiny" style="margin-top:8px;">
        URL: <a href="${url}" target="_blank" rel="noopener">${url}</a><br/>
        ${p ? `Pending deploy to <span class="mono">${shortSha(p.commit)}</span>…` : `Last: ${fmtTime(s?.pages?.createdOn)}`}
        ${stageStatus ? ` • stage: <span class="mono">${stageStatus}</span>` : ``}
        ${s?.pages?.error ? ` • error: <span class="mono">${s.pages.error}</span>` : ``}
      </div>
    </div>
    <div class="right tiny">
      ${s?.pages?.message ? `<div title="${s.pages.message.replace(/"/g, '&quot;')}">${s.pages.message.slice(0, 42)}${s.pages.message.length > 42 ? "…" : ""}</div>` : `<div>—</div>`}
    </div>
  `;

  return row;
}

function showCommitError(msg) {
  $("commitError").textContent = msg || "";
}

function clearCommitError() {
  $("commitError").textContent = "";
}

async function checkAuth() {
  try {
    await apiGet("/");
    return true;
  } catch {
    return false;
  }
}

function setAuthUI(isAuthed) {
  const dot = document.getElementById("loginDot");
  const text = document.getElementById("loginText");

  if (isAuthed) {
    dot.className = "dot ok";
    text.textContent = "Authenticated";
  } else {
    dot.className = "dot warn";
    text.textContent = "Login";
  }
}

async function refreshOne(appId, envName) {
  try {
    const s = await apiGet(`/status?app=${encodeURIComponent(appId)}&env=${encodeURIComponent(envName)}`);
    state.status[appId][envName] = s;

    const pending = state.pending[appId][envName];
    const deployed = s?.pages?.commit || null;
    if (pending && deployed && shortSha(deployed) === shortSha(pending.commit)) {
      state.pending[appId][envName] = null;
    }
  } catch (e) {
    state.status[appId][envName] = { status: "OK", pages: { error: e.message } };
  }
}

async function refreshAll() {
  for (const app of APPS) {
    await refreshOne(app.id, "dev");
    await refreshOne(app.id, "prod");
  }
}

async function loadCommits(envName) {
  setApiError("");
  try {
    const data = await apiGet(`/commits?env=${encodeURIComponent(envName)}&limit=12`);
    state.commitsCache[envName] = data.commits || [];
    return state.commitsCache[envName];
  } catch (e) {
    setApiError(e.message);
    state.commitsCache[envName] = [];
    return [];
  }
}

function renderCommitSelect(envName) {
  const sel = $("commitSelect");
  const commits = state.commitsCache[envName] || [];
  sel.innerHTML = "";

  if (!commits.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No commits loaded (check API/auth)";
    sel.appendChild(opt);
    return;
  }

  for (const c of commits) {
    const opt = document.createElement("option");
    opt.value = c.sha;
    opt.textContent = `${c.short} — ${c.message}`;
    sel.appendChild(opt);
  }
}

async function deploy(appId, envName, commit) {
  clearCommitError();
  state.pending[appId][envName] = { commit, since: Date.now() };
  renderApps();

  logItem(`Deploy ${appId} → ${envName}`, `Requested commit <span class="mono">${shortSha(commit)}</span>`);

  const resp = await apiPost("/deploy", { app: appId, env: envName, commit });

  logItem(
    "Triggered deployment",
    `Hook called (HTTP ${resp?.trigger?.httpStatus ?? "?"}). Commit: <span class="mono">${shortSha(resp.commit)}</span>`
  );

  await sleep(30000);
  for (let i = 0; i < 90; i++) {
    await sleep(1200);
    await refreshOne(appId, envName);
    renderApps();

    const s = state.status?.[appId]?.[envName];
    const deployed = s?.pages?.commit;
    const st = String(s?.pages?.stageStatus || "").toLowerCase();

    if (deployed && shortSha(deployed) === shortSha(commit) && st === "success") {
      break;
    }
  }
}

function wire() {
  $("refreshAllBtn").addEventListener("click", async () => {
    $("refreshAllBtn").disabled = true;
    try {
      await runWithRefreshing(async () => {
        await refreshAll();
        renderApps();
      });
      logItem("Refreshed", "Refreshed status for all apps/environments.");
    } finally {
      $("refreshAllBtn").disabled = false;
    }
    setAuthUI(await checkAuth());
  });

  $("loginBtn").addEventListener("click", () => {
    const back = encodeURIComponent(window.location.href);
    window.location.href = `${API_BASE}/?redirect_url=${back}`;
  });


  $("commitInput").addEventListener("input", clearCommitError);

  $("clearLogBtn").addEventListener("click", () => {
    clearLog();
  });

  $("envSelect").addEventListener("change", async () => {
    const envName = $("envSelect").value;
    await loadCommits(envName);
    renderCommitSelect(envName);
  });

  $("deployBtn").addEventListener("click", async () => {
    const appId = $("appSelect").value;
    const envName = $("envSelect").value;
    const commit = $("commitSelect").value;

    if (!commit) return alert("Please select a commit.");

    try {
      $("deployBtn").disabled = true;
      await deploy(appId, envName, commit);
    } catch (e) {
      state.pending[appId][envName] = null;
      renderApps();
      logItem("Deploy failed", e.message);
      alert(`Deploy failed: ${e.message}`);
    } finally {
      $("deployBtn").disabled = false;
    }
  });

  $("deployInputBtn").addEventListener("click", async () => {
    const appId = $("appSelect").value;
    const envName = $("envSelect").value;
    const commit = ($("commitInput").value || "").trim();

    if (!shaRe.test(commit)) {
      showCommitError("Invalid commit SHA (expected 7–40 hexadecimal characters).");
      return;
    }

    try {
      $("deployInputBtn").disabled = true;
      await deploy(appId, envName, commit);
    } catch (e) {
      state.pending[appId][envName] = null;
      renderApps();
      logItem("Deploy failed", e.message);
      showCommitError(e.message);
    } finally {
      $("deployInputBtn").disabled = false;
    }
  });
}

(async function main() {
  clearLog();
  await refreshAll();
  renderApps();
  wire();

  const envName = $("envSelect").value;
  await loadCommits(envName);
  renderCommitSelect(envName);
  checkAuth().then(setAuthUI);
})();
