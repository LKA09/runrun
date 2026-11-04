import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import jpeg from "jpeg-js";

// These integration tests target ONLY the local Wrangler DB and loopback server.
const base = "http://127.0.0.1:8787",
  origin = "http://127.0.0.1:5173";
const actor = randomUUID(),
  other = randomUUID(),
  token = randomUUID(),
  otherToken = randomUUID();
let cookie = "",
  otherCookie = "";
function sql(query: string) {
  writeFileSync(".local/test-fixtures.sql", query);
  execFileSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "worker/wrangler.jsonc",
      "--file",
      ".local/test-fixtures.sql",
    ],
    { stdio: "pipe" },
  );
}
function signed(token: string, secret: string) {
  return (
    "runrun-dev.session_token=" +
    encodeURIComponent(
      token + "." + createHmac("sha256", secret).update(token).digest("base64"),
    )
  );
}
async function request(path: string, options: RequestInit = {}) {
  return fetch(base + path, {
    ...options,
    headers: { Origin: origin, ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
}
before(async () => {
  const health = await request("/api/health");
  assert.equal((await health.json()).service, "runrun");
  const vars = readFileSync("worker/.dev.vars", "utf8");
  const secret = vars.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1];
  assert.ok(secret);
  cookie = signed(token, secret);
  otherCookie = signed(otherToken, secret);
  const now = Date.now();
  sql(
    `INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('${actor}','QA Runner','${actor}@example.invalid',1,${now},${now}),('${other}','Other Runner','${other}@example.invalid',1,${now},${now}); INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES('${randomUUID()}','${actor}','${token}',${now + 3600000},${now},${now}),('${randomUUID()}','${other}','${otherToken}',${now + 3600000},${now},${now});`,
  );
});
after(() => sql(`DELETE FROM user WHERE id IN ('${actor}','${other}');`));
test("unauthenticated writes, forged cookies and untrusted origins fail closed", async () => {
  assert.equal((await request("/api/posts", { method: "POST" })).status, 401);
  assert.equal(
    (
      await request("/api/posts", {
        method: "POST",
        headers: { Cookie: "runrun-dev.session_token=forged" },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(base + "/api/posts", { method: "POST" })).status,
    403,
  );
  const hostile = await request("/api/posts", {
    method: "POST",
    headers: { Origin: "https://evil.test" },
  });
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.has("access-control-allow-origin"), false);
  assert.equal(
    (
      await request("/api/posts", {
        method: "POST",
        body: "x".repeat(1_500_001),
      })
    ).status,
    413,
  );
});
test("private identity is minimized, malformed cursors are rejected and headers prevent caching/sniffing", async () => {
  const res = await request("/api/me", { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.id, actor);
  assert.equal(body.user.email, undefined);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await request("/api/posts?cursor=sql-injection")).status, 400);
  assert.equal((await request("/api/posts?mine=true")).status, 401);
});
test("actual D1/R2 upload, ownership enforcement, idempotent likes, and deletion", async () => {
  const data = jpeg.encode(
    {
      data: Buffer.from([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
      ]),
      width: 2,
      height: 2,
    },
    80,
  ).data;
  function form(photo: Blob) {
    const f = new FormData();
    f.set("caption", "<script>alert(1)</script> is plain text");
    f.set("distance", "5.25");
    f.set("duration", "30");
    f.set("runDate", "2026-11-04");
    f.set("photo", photo, "run.jpg");
    return f;
  }
  const bad = await request("/api/posts", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(new Blob(["<svg onload=alert(1)>"], { type: "image/jpeg" })),
  });
  assert.equal(bad.status, 400);
  const created = await request("/api/posts", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form(new Blob([data], { type: "image/jpeg" })),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  try {
    const photo = await request("/api/photos/" + id);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/jpeg");
    assert.ok((await photo.arrayBuffer()).byteLength > 100);
    const feed = await (
      await request("/api/posts?mine=true", { headers: { Cookie: cookie } })
    ).json();
    assert.ok(feed.posts.some((p: { id: string }) => p.id === id));
    assert.ok(!JSON.stringify(feed).includes("@example.invalid"));
    assert.equal(
      (
        await request("/api/posts/" + id, {
          method: "DELETE",
          headers: { Cookie: otherCookie },
        })
      ).status,
      404,
    );
    for (let i = 0; i < 2; i++) {
      const like = await request("/api/posts/" + id + "/like", {
        method: "PUT",
        headers: { Cookie: otherCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ liked: true }),
      });
      assert.equal(like.status, 200);
      assert.equal((await like.json()).likes, 1);
    }
    assert.equal(
      (
        await request("/api/posts/" + id, {
          method: "DELETE",
          headers: { Cookie: cookie },
        })
      ).status,
      200,
    );
    assert.equal((await request("/api/photos/" + id)).status, 404);
  } finally {
    await request("/api/posts/" + id, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
  }
});
