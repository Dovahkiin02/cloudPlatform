const appSel = document.getElementById("app");
const envSel = document.getElementById("env");
const out = document.getElementById("out");

function print(obj) {
  out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

document.getElementById("deploy").addEventListener("click", () => {
  print({ action: "deploy", app: appSel.value, env: envSel.value });
});

document.getElementById("status").addEventListener("click", () => {
  print({ action: "status", app: appSel.value, env: envSel.value });
});
