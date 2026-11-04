import "reflect-metadata";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app";
import { createAuth } from "./auth";
import type { Env } from "./env";
import {
  trustedOrigin,
  digest,
  rateLimit,
  securityHeaders,
  postId,
  MAX_UPLOAD,
} from "./security";

let bootstrap:
  | Promise<{
      auth: ReturnType<typeof createAuth>;
      node: ReturnType<typeof httpServerHandler>;
    }>
  | undefined;
function boot(env: Env) {
  return (bootstrap ??= (async () => {
    const auth = createAuth(env);
    const server = await createApp(env, auth);
    return { auth, node: httpServerHandler(server) };
  })().catch((e) => {
    bootstrap = undefined;
    throw e;
  }));
}
function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}
async function bounded(
  request: Request,
  maximum: number,
): Promise<Request | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maximum) return null;
  if (!request.body) return request;
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body: data });
}
export default {
  async fetch(
    original: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const origin = original.headers.get("origin"),
      url = new URL(original.url);
    const headers = new Headers(securityHeaders);
    headers.set("Vary", "Origin");
    if (origin === env.FRONTEND_URL) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Credentials", "true");
    }
    const finish = (res: Response) => {
      const result = new Response(res.body, res);
      for (const [k, v] of headers) result.headers.set(k, v);
      return result;
    };
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (
          env.ENVIRONMENT !== "production" ||
          url.origin !== env.FRONTEND_URL ||
          !["GET", "HEAD"].includes(original.method)
        )
          return finish(response({ error: "Not found" }, 404));
        // On a same-zone Worker route, fetch continues to the GitHub Pages origin.
        // Never forward login cookies or authorization headers to the static host.
        const outgoing = new Headers(original.headers);
        outgoing.delete("cookie");
        outgoing.delete("authorization");
        const page = await fetch(new Request(original, { headers: outgoing }));
        const result = new Response(page.body, page);
        for (const [key, value] of Object.entries(securityHeaders))
          if (key !== "Cache-Control") result.headers.set(key, value);
        result.headers.delete("set-cookie");
        result.headers.set(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
        );
        return result;
      }
      const write = !["GET", "HEAD", "OPTIONS"].includes(original.method);
      if (origin && !trustedOrigin(origin, env.FRONTEND_URL, env.API_URL))
        return finish(response({ error: "허용되지 않은 출처입니다." }, 403));
      if (write && !trustedOrigin(origin, env.FRONTEND_URL, env.API_URL))
        return finish(response({ error: "출처를 확인할 수 없습니다." }, 403));
      if (original.method === "OPTIONS") {
        headers.set(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
        headers.set("Access-Control-Allow-Headers", "Content-Type");
        headers.set("Access-Control-Max-Age", "600");
        return finish(new Response(null, { status: 204 }));
      }
      if (url.pathname === "/api/health")
        return finish(
          response({
            ok: true,
            service: "runrun",
            authConfigured: Boolean(
              env.GOOGLE_CLIENT_ID &&
              env.GOOGLE_CLIENT_SECRET &&
              env.BETTER_AUTH_SECRET,
            ),
          }),
        );
      const ip = await digest(
        original.headers.get("cf-connecting-ip") ?? "local",
      );
      const authPath = url.pathname.startsWith("/api/auth/");
      if (
        !(await rateLimit(
          env.DB,
          `${authPath ? "auth" : "api"}:${ip}`,
          authPath ? 30 : 240,
          60,
        ))
      ) {
        headers.set("Retry-After", "60");
        return finish(
          response({ error: "요청이 많아요. 잠시 후 다시 시도해주세요." }, 429),
        );
      }
      const request = write
        ? await bounded(original, authPath ? 16_384 : MAX_UPLOAD)
        : original;
      if (!request)
        return finish(response({ error: "업로드 용량을 초과했습니다." }, 413));
      const photoMatch = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
      if (photoMatch && original.method === "GET") {
        if (!postId.safeParse(photoMatch[1]).success)
          return finish(response({ error: "사진이 없습니다." }, 404));
        const row = await env.DB.prepare(
          "SELECT photo_key FROM posts WHERE id=?",
        )
          .bind(photoMatch[1])
          .first<{ photo_key: string }>();
        const object = row ? await env.PHOTOS.get(row.photo_key) : null;
        if (!object)
          return finish(response({ error: "사진이 없습니다." }, 404));
        // no-store ensures deletion takes effect immediately, including browser caches.
        return finish(
          new Response(object.body, {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Disposition": 'inline; filename="run.jpg"',
            },
          }),
        );
      }
      const app = await boot(env);
      if (authPath) {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
          return finish(
            response({ error: "Google 로그인을 준비 중입니다." }, 503),
          );
        return finish(await app.auth.handler(request));
      }
      return finish(
        await app.node.fetch!(
          request as Request<unknown, IncomingRequestCfProperties>,
          env,
          ctx,
        ),
      );
    } catch {
      console.error("runrun_request_failure");
      return finish(response({ error: "서버 연결을 확인해주세요." }, 503));
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env) {
    const stale = Date.now() - 3_600_000;
    const { results } = await env.DB.prepare(
      "SELECT photo_key FROM photo_cleanup WHERE created_at<? LIMIT 100",
    )
      .bind(stale)
      .all<{ photo_key: string }>();
    for (const row of results) {
      if (
        !(await env.DB.prepare("SELECT id FROM posts WHERE photo_key=?")
          .bind(row.photo_key)
          .first())
      )
        await env.PHOTOS.delete(row.photo_key);
      await env.DB.prepare("DELETE FROM photo_cleanup WHERE photo_key=?")
        .bind(row.photo_key)
        .run();
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
        Math.floor(Date.now() / 1000),
      ),
      env.DB.prepare("DELETE FROM session WHERE expires_at<?").bind(Date.now()),
      env.DB.prepare("DELETE FROM verification WHERE expires_at<?").bind(
        Date.now(),
      ),
    ]);
  },
};
