import { z } from "zod";
export const MAX_UPLOAD = 1_500_000;
export const MAX_PHOTO = 1_200_000;
export function koreaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const postSchema = z
  .object({
    caption: z.string().trim().max(300),
    distance: z.coerce
      .number()
      .positive()
      .max(300)
      .refine((n) => Number.isFinite(n)),
    duration: z.coerce.number().int().positive().max(4320),
    runDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => {
        const d = new Date(`${s}T00:00:00Z`);
        return (
          !Number.isNaN(d.getTime()) &&
          d.toISOString().slice(0, 10) === s &&
          s <= koreaDate() &&
          s >= "2000-01-01"
        );
      }),
  })
  .strict();
export const postId = z.string().uuid();
export const cursorSchema = z.string().regex(/^\d{13}_[0-9a-f-]{36}$/);
export const likeSchema = z.object({ liked: z.boolean() }).strict();
export function trustedOrigin(
  origin: string | null,
  frontend: string,
  api: string,
) {
  return origin !== null && (origin === frontend || origin === api);
}
export async function digest(value: string) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(result)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000),
    slot = Math.floor(now / windowSeconds);
  const row = await db
    .prepare(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(`${key}:${slot}`, (slot + 1) * windowSeconds)
    .first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Strict-Transport-Security": "max-age=31536000",
  "Cache-Control": "no-store",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
