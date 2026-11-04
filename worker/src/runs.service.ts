import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
} from "@nestjs/common";
import type { Request } from "express";
import { sanitizeJpeg } from "./jpeg";
import type { Env } from "./env";
import type { Auth } from "./auth";
import {
  postSchema,
  postId,
  cursorSchema,
  likeSchema,
  koreaDate,
  rateLimit,
  MAX_PHOTO,
} from "./security";

@Injectable()
export class RunsService {
  constructor(
    @Inject("ENV") private readonly env: Env,
    @Inject("AUTH") private readonly auth: Auth,
  ) {}
  async identity(req: Request, required = false) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(key, value);
    const identity = await this.auth.api.getSession({ headers });
    if (required && (!identity || !identity.user.emailVerified))
      throw new UnauthorizedException("Google 로그인이 필요합니다.");
    return identity;
  }
  async me(req: Request) {
    const identity = await this.identity(req);
    return {
      user: identity
        ? { id: identity.user.id, name: identity.user.name }
        : null,
    };
  }
  async list(req: Request) {
    const parsed = new URL(req.originalUrl, this.env.API_URL);
    const mine = parsed.searchParams.get("mine") === "true";
    const identity = await this.identity(req, mine);
    const cursor = parsed.searchParams.get("cursor");
    if (cursor && !cursorSchema.safeParse(cursor).success)
      throw new BadRequestException("잘못된 페이지입니다.");
    const conditions: string[] = [];
    const args: (string | number)[] = [identity?.user.id ?? ""];
    if (mine) {
      conditions.push("p.user_id = ?");
      args.push(identity!.user.id);
    }
    if (cursor) {
      const [time, id] = cursor.split("_");
      conditions.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
      args.push(Number(time), Number(time), id);
    }
    const { results } = await this.env.DB.prepare(
      `SELECT p.id,p.user_id AS userId,p.caption,p.distance,p.duration,p.run_date AS runDate,p.created_at AS createdAt,u.name AS author,(SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS likes,EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM posts p JOIN user u ON u.id=p.user_id ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY p.created_at DESC,p.id DESC LIMIT 13`,
    )
      .bind(...args)
      .all();
    const more = results.length > 12,
      posts = results
        .slice(0, 12)
        .map((p) => ({
          ...p,
          liked: Boolean(p.liked),
          photoUrl: `${this.env.API_URL}/api/photos/${p.id}`,
        }));
    const last = results.slice(0, 12).at(-1);
    return {
      posts,
      cursor: more && last ? `${last.createdAt}_${last.id}` : null,
    };
  }
  async create(req: Request) {
    const identity = (await this.identity(req, true))!;
    if (!(await rateLimit(this.env.DB, `post:${identity.user.id}`, 15, 3600)))
      throw new HttpException("잠시 후 다시 인증해주세요.", 429);
    if (!Buffer.isBuffer(req.body))
      throw new BadRequestException("사진과 기록을 함께 첨부해주세요.");
    let form: FormData;
    try {
      form = await new globalThis.Request(`${this.env.API_URL}/api/posts`, {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] ?? "" },
        body: new Uint8Array(req.body),
      }).formData();
    } catch {
      throw new BadRequestException("사진 업로드 형식이 올바르지 않습니다.");
    }
    const allowed = new Set([
      "caption",
      "distance",
      "duration",
      "runDate",
      "photo",
    ]);
    for (const key of form.keys())
      if (!allowed.has(key) || form.getAll(key).length !== 1)
        throw new BadRequestException("잘못된 입력입니다.");
    const values = postSchema.safeParse(
      Object.fromEntries(
        ["caption", "distance", "duration", "runDate"].map((k) => [
          k,
          form.get(k),
        ]),
      ),
    );
    if (!values.success)
      throw new BadRequestException(
        "거리, 시간, 날짜와 300자 이내의 글을 확인해주세요.",
      );
    const photo = form.get("photo");
    if (
      !photo ||
      typeof photo === "string" ||
      photo.type !== "image/jpeg" ||
      photo.size > MAX_PHOTO ||
      photo.size < 100
    )
      throw new BadRequestException("1.2MB 이하의 JPEG 사진이 필요합니다.");
    let clean: Uint8Array;
    try {
      // Strict marker/dimension validation and metadata stripping avoid decompression
      // bombs and expensive server-side pixel processing on the Workers free tier.
      clean = sanitizeJpeg(new Uint8Array(await photo.arrayBuffer()));
      if (clean.byteLength > MAX_PHOTO) throw new Error("Image too large");
    } catch {
      throw new BadRequestException(
        "사진을 읽을 수 없어요. 다른 사진을 선택해주세요.",
      );
    }
    const id = crypto.randomUUID(),
      key = `${identity.user.id}/${id}.jpg`,
      created = Date.now();
    // Durable cleanup marker survives a process failure between R2 and D1 writes.
    await this.env.DB.prepare(
      "INSERT INTO photo_cleanup(photo_key,created_at) VALUES(?,?)",
    )
      .bind(key, created)
      .run();
    await this.env.PHOTOS.put(key, clean, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const { caption, distance, duration, runDate } = values.data;
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO posts(id,user_id,caption,distance,duration,run_date,photo_key,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        identity.user.id,
        caption,
        distance,
        duration,
        runDate,
        key,
        created,
      ),
      this.env.DB.prepare("DELETE FROM photo_cleanup WHERE photo_key=?").bind(
        key,
      ),
    ]);
    return { id };
  }
  async like(req: Request, id: string) {
    const identity = (await this.identity(req, true))!;
    const data = likeSchema.safeParse(req.body);
    if (!postId.safeParse(id).success || !data.success)
      throw new BadRequestException("잘못된 요청입니다.");
    if (!(await rateLimit(this.env.DB, `like:${identity.user.id}`, 90, 60)))
      throw new HttpException("잠시 후 다시 시도해주세요.", 429);
    if (
      !(await this.env.DB.prepare("SELECT id FROM posts WHERE id=?")
        .bind(id)
        .first())
    )
      throw new NotFoundException();
    if (data.data.liked)
      await this.env.DB.prepare(
        "INSERT OR IGNORE INTO likes(post_id,user_id) VALUES(?,?)",
      )
        .bind(id, identity.user.id)
        .run();
    else
      await this.env.DB.prepare(
        "DELETE FROM likes WHERE post_id=? AND user_id=?",
      )
        .bind(id, identity.user.id)
        .run();
    const count = await this.env.DB.prepare(
      "SELECT count(*) AS count FROM likes WHERE post_id=?",
    )
      .bind(id)
      .first<{ count: number }>();
    return { liked: data.data.liked, likes: count!.count };
  }
  async remove(req: Request, id: string) {
    const identity = (await this.identity(req, true))!;
    if (!postId.safeParse(id).success) throw new BadRequestException();
    const post = await this.env.DB.prepare(
      "SELECT photo_key FROM posts WHERE id=? AND user_id=?",
    )
      .bind(id, identity.user.id)
      .first<{ photo_key: string }>();
    if (!post)
      throw new NotFoundException("본인 인증 기록만 삭제할 수 있습니다.");
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT OR IGNORE INTO photo_cleanup(photo_key,created_at) VALUES(?,?)",
      ).bind(post.photo_key, Date.now()),
      this.env.DB.prepare("DELETE FROM posts WHERE id=? AND user_id=?").bind(
        id,
        identity.user.id,
      ),
    ]);
    await this.env.PHOTOS.delete(post.photo_key);
    await this.env.DB.prepare("DELETE FROM photo_cleanup WHERE photo_key=?")
      .bind(post.photo_key)
      .run();
    return { ok: true };
  }
  async stats(req: Request) {
    const identity = await this.identity(req);
    const today = koreaDate(),
      first = today.slice(0, 8) + "01";
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const week = start.toISOString().slice(0, 10);
    const queries = [
      this.env.DB.prepare(
        "SELECT count(*) AS runs,coalesce(sum(distance),0) AS distance,count(DISTINCT user_id) AS runners FROM posts WHERE run_date>=?",
      ).bind(first),
      this.env.DB.prepare(
        "SELECT u.name,sum(p.distance) AS distance,count(*) AS runs FROM posts p JOIN user u ON p.user_id=u.id WHERE p.run_date>=? GROUP BY p.user_id ORDER BY distance DESC,runs DESC,p.user_id LIMIT 5",
      ).bind(week),
      this.env.DB.prepare(
        "SELECT count(*) AS runs,coalesce(sum(distance),0) AS distance,coalesce(sum(duration),0) AS duration FROM posts WHERE user_id=? AND run_date>=?",
      ).bind(identity?.user.id ?? "", first),
      this.env.DB.prepare(
        "SELECT DISTINCT run_date FROM posts WHERE user_id=? AND run_date>=? ORDER BY run_date",
      ).bind(identity?.user.id ?? "", week),
    ];
    const rows = await this.env.DB.batch(queries);
    return {
      community: rows[0].results[0],
      leaders: rows[1].results,
      personal: rows[2].results[0],
      days: rows[3].results.map((r) => (r as { run_date: string }).run_date),
    };
  }
}
