import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Env } from "./env";

export function createAuth(env: Env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw new Error("Missing authentication secret");
  const production = env.ENVIRONMENT === "production";
  return betterAuth({
    appName: "RUNRUN",
    baseURL: env.API_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    trustedOrigins: [env.FRONTEND_URL],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: "online",
        prompt: "select_account",
      },
    },
    account: {
      accountLinking: { enabled: false },
      storeAccountCookie: false,
      encryptOAuthTokens: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
      storeSessionInDatabase: true,
    },
    advanced: {
      useSecureCookies: production,
      cookiePrefix: production ? "runrun" : "runrun-dev",
      defaultCookieAttributes: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
      },
      crossSubDomainCookies: { enabled: false },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    // Persistent, atomic D1 rate limiting is applied before every auth request at the Worker boundary.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
