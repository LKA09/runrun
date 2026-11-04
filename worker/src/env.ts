export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  FRONTEND_URL: string;
  API_URL: string;
  ENVIRONMENT: "production" | "development";
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
