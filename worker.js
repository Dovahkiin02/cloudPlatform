export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const ALLOWED_ORIGINS = new Set([
      "https://dev-8no.pages.dev",
    ]);

    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "null";

    const corsHeaders = {
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers":
        request.headers.get("Access-Control-Request-Headers") || "content-type,authorization",
      "access-control-allow-credentials": "true",
      vary: "Origin",
    };

    const withCors = (res) => {
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    };

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const json = (status, obj) =>
      withCors(
        new Response(JSON.stringify(obj, null, 2), {
          status,
          headers: { "content-type": "application/json; charset=utf-8" },
        })
      );

    const ALLOWED_APPS = ["app-a", "app-b"];
    const ALLOWED_ENVS = ["dev", "prod"];

    const SOURCE_BRANCH = { dev: "dev", prod: "main" };

    const RELEASE_BRANCH = {
      "app-a": { dev: "release/app-a-dev", prod: "release/app-a-main" },
      "app-b": { dev: "release/app-b-dev", prod: "release/app-b-main" },
    };
    const PAGES_PROJECT = { "app-a": "app-a", "app-b": "app-b" };

    const DEPLOY_HOOK = {
      "app-a": { dev: env.HOOK_APP_A_DEV, prod: env.HOOK_APP_A_PROD },
      "app-b": { dev: env.HOOK_APP_B_DEV, prod: env.HOOK_APP_B_PROD },
    };

    const shaRe = /^[0-9a-f]{7,40}$/i;

    function requireGh() {
      if (!env.GH_OWNER || !env.GH_REPO || !env.GH_TOKEN) {
        throw new Error("Missing GH_OWNER / GH_REPO / GH_TOKEN in Worker secrets.");
      }
    }

    async function gh(apiPath, init = {}) {
      requireGh();
      const res = await fetch(`https://api.github.com${apiPath}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "deployment-api-worker",
          ...(init.headers || {}),
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data?.message ||
          data?.errors?.[0]?.message ||
          `GitHub API error (${res.status})`;
        throw new Error(msg);
      }
      return data;
    }

    async function ghListCommits(branch, limit) {
      const owner = env.GH_OWNER;
      const repo = env.GH_REPO;

      const perPage = Math.max(1, Math.min(50, limit || 10));
      const commits = await gh(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`);

      return (commits || []).map((c) => ({
        sha: c?.sha || null,
        short: (c?.sha || "").slice(0, 7),
        message: (c?.commit?.message || "").split("\n")[0].slice(0, 80),
        author: c?.commit?.author?.name || null,
        date: c?.commit?.author?.date || null,
        url: c?.html_url || null,
      }));
    }

    async function ghResolveCommitish(commitish) {
      const owner = env.GH_OWNER;
      const repo = env.GH_REPO;

      const c = await gh(`/repos/${owner}/${repo}/commits/${encodeURIComponent(commitish)}`);
      return {
        sha: c?.sha || commitish,
        message: (c?.commit?.message || "").split("\n")[0].slice(0, 80),
      };
    }

    async function ghUpdateBranchRef(branchName, sha) {
      const owner = env.GH_OWNER;
      const repo = env.GH_REPO;

      return gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha, force: true }),
      });
    }

    function requireCf() {
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        throw new Error("Missing CF_ACCOUNT_ID / CF_API_TOKEN in Worker secrets.");
      }
    }

    function nowIso() {
      return new Date().toISOString();
    }

    function rid() {
      return crypto.randomUUID();
    }

    async function logEvent(env, event) {
      if (!env.DEPLOYMENT_LOG) return null;
      const id = event.id || rid();
      const key = `event:${event.ts}:${id}`;
      await env.DEPLOYMENT_LOG.put(key, JSON.stringify(event));
      return key;
    }


    async function listEvents(env, { limit = 50, app, envName } = {}) {
      const res = await env.DEPLOYMENT_LOG.list({ prefix: "event:", limit: Math.min(Number(limit) || 50, 200) });
      const items = [];

      for (const k of res.keys) {
        const raw = await env.DEPLOYMENT_LOG.get(k.name);
        if (!raw) continue;
        const e = JSON.parse(raw);

        if (app && e.app !== app) continue;
        if (envName && e.env !== envName) continue;

        items.push(e);
      }

      items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      return items;
    }

    async function clearEvents(env) {
      let cursor;
      do {
        const res = await env.DEPLOYMENT_LOG.list({ prefix: "event:", cursor });
        for (const k of res.keys) {
          await env.DEPLOYMENT_LOG.delete(k.name);
        }
        cursor = res.list_complete ? null : res.cursor;
      } while (cursor);
    }

    async function cfPagesGetDeployments(projectName) {
      requireCf();
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${projectName}/deployments`;

      const res = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "content-type": "application/json",
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg =
          data?.errors?.[0]?.message ||
          data?.messages?.[0]?.message ||
          `Pages API error (${res.status})`;
        throw new Error(msg);
      }

      return data?.result ?? [];
    }

    function extractBranch(deployment) {
      return deployment?.deployment_trigger?.metadata?.branch || null;
    }
    function extractCommit(deployment) {
      return (
        deployment?.deployment_trigger?.metadata?.commit_hash ||
        deployment?.deployment_trigger?.metadata?.commit ||
        deployment?.source?.commit_hash ||
        deployment?.source?.commit ||
        null
      );
    }
    function extractCommitMessage(deployment) {
      return (
        deployment?.deployment_trigger?.metadata?.commit_message ||
        deployment?.deployment_trigger?.metadata?.message ||
        null
      );
    }
    function latestForBranch(deployments, branch) {
      for (const d of deployments) {
        if (extractBranch(d) === branch) return d;
      }
      return deployments?.[0] ?? null;
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json(200, { ok: true, service: "deployment-api" });
    }

    if (request.method === "GET" && url.pathname === "/commits") {
      const envName = url.searchParams.get("env") || "dev";
      const limit = Number(url.searchParams.get("limit") || "12");

      if (!ALLOWED_ENVS.includes(envName)) {
        return json(400, { error: `Invalid env.` });
      }

      const branch = SOURCE_BRANCH[envName];
      try {
        const commits = await ghListCommits(branch, limit);
        return json(200, { env: envName, branch, commits });
      } catch (e) {
        return json(502, { error: e.message, env: envName, branch });
      }
    }

    if (request.method === "POST" && url.pathname === "/deploy") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }

      const app = body?.app;
      const envName = body?.env;
      const commitIn = (body?.commit || "").trim();

      if (!ALLOWED_APPS.includes(app)) {
        return json(400, { error: `Invalid app.` });
      }
      if (!ALLOWED_ENVS.includes(envName)) {
        return json(400, { error: `Invalid env.` });
      }
      if (!shaRe.test(commitIn)) {
        return json(400, { error: "Invalid commit SHA. Expected 7–40 hex characters." });
      }

      const releaseBranch = RELEASE_BRANCH[app][envName];
      const hookUrl = DEPLOY_HOOK?.[app]?.[envName];
      if (!hookUrl) {
        return json(500, { error: "Missing deploy hook URL secret for this app/env." });
      }

      let commit;
      try {
        commit = await ghResolveCommitish(commitIn);
      } catch (e) {
        return json(400, { error: `Commit not found or not accessible` });
      }

      try {
        await ghUpdateBranchRef(releaseBranch, commit.sha);
      } catch (e) {
        return json(502, { error: `Failed to move ${releaseBranch}` });
      }

      let hookStatus = null;
      try {
        const hookRes = await fetch(hookUrl, { method: "POST" });
        hookStatus = hookRes.status;
        if (!hookRes.ok) {
          return json(502, {
            error: `Deploy hook call failed (HTTP ${hookRes.status})`,
            app,
            env: envName,
            releaseBranch,
            commit: commit.sha,
          });
        }
      } catch (e) {
        return json(502, { error: `Deploy hook call failed: ${e.message}` });
      }

      const event = {
        id: rid(),
        ts: nowIso(),
        type: "deploy",
        app,
        env: envName,
        commitSha: commit.sha,
        commitMsg: commit.message,
        actor: request.headers.get("Cf-Access-Authenticated-User-Email") || null,
        result: {
          hookStatus,
          hookOk: hookStatus != null && hookStatus >= 200 && hookStatus < 300,
          releaseBranch,
        },
      };

      await logEvent(env, event);


      return json(202, {
        action: "deploy",
        app,
        env: envName,
        sourceBranch: SOURCE_BRANCH[envName],
        releaseBranch,
        commit: commit.sha,
        message: commit.message,
        status: "ACCEPTED",
        trigger: { type: "deploy_hook", httpStatus: hookStatus },
      });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const app = url.searchParams.get("app");
      const envName = url.searchParams.get("env");

      if (!ALLOWED_APPS.includes(app)) {
        return json(400, { error: `Invalid app. Allowed: ${ALLOWED_APPS.join(", ")}` });
      }
      if (!ALLOWED_ENVS.includes(envName)) {
        return json(400, { error: `Invalid env. Allowed: ${ALLOWED_ENVS.join(", ")}` });
      }

      const projectName = PAGES_PROJECT[app];
      const expectedBranch = RELEASE_BRANCH[app][envName];

      try {
        const deployments = await cfPagesGetDeployments(projectName);
        const deployment = latestForBranch(deployments, expectedBranch);

        return json(200, {
          action: "status",
          app,
          env: envName,
          expectedBranch,
          pages: deployment
            ? {
              project: projectName,
              deploymentId: deployment?.id ?? null,
              deploymentUrl: deployment?.url ?? null,
              createdOn: deployment?.created_on ?? null,
              commit: extractCommit(deployment),
              message: extractCommitMessage(deployment),
              branch: extractBranch(deployment),
              stageStatus: deployment?.latest_stage?.status ?? null,
            }
            : { project: projectName, error: "No deployments returned." },
        });
      } catch (e) {
        return json(200, {
          action: "status",
          app,
          env: envName,
          expectedBranch,
          pages: { project: projectName, error: e.message },
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/history") {
      const limit = Number(url.searchParams.get("limit")) || 50;
      const app = url.searchParams.get("app") || "";
      const envName = url.searchParams.get("env") || "";

      const events = await listEvents(env, {
        limit: limit,
        app: app || undefined,
        envName: envName || undefined,
      });

      return json(200, { events });
    }

    if (request.method === "POST" && url.pathname === "/history/clear") {
      await clearEvents(env);
      return json(200, { ok: true });
    }

    return json(404, { error: "Not Found" });
  },
};
