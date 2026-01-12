const appSel = document.getElementById("app");
const envSel = document.getElementById("env");
const out = document.getElementById("out");

const API_BASE = "https://deployment-api.manuel-hanifl.workers.dev";

function print(obj) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

async function deploy() {
  print("Calling /deploy ...");
  const res = await fetch(`${API_BASE}/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: appSel.value, env: envSel.value }),
  });
  print(await res.json());
}

async function status() {
  print("Calling /status ...");
  const app = encodeURIComponent(appSel.value);
  const env = encodeURIComponent(envSel.value);
  const res = await fetch(`${API_BASE}/status?app=${app}&env=${env}`);
  print(await res.json());
}

document.getElementById("deploy").addEventListener("click", deploy);
document.getElementById("status").addEventListener("click", status);
