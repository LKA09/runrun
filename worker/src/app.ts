import "reflect-metadata";
import {
  Controller,
  Module,
  Get,
  Post,
  Put,
  Delete,
  Req,
  Param,
  Inject,
  Catch,
  HttpException,
} from "@nestjs/common";
import type { ExceptionFilter, ArgumentsHost } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import type { Request, Response } from "express";
import { RunsService } from "./runs.service";
import type { Env } from "./env";
import type { Auth } from "./auth";
import { MAX_UPLOAD } from "./security";

@Controller("api")
class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}
  @Get("me") me(@Req() req: Request) {
    return this.runs.me(req);
  }
  @Get("posts") list(@Req() req: Request) {
    return this.runs.list(req);
  }
  @Post("posts") create(@Req() req: Request) {
    return this.runs.create(req);
  }
  @Put("posts/:id/like") like(@Req() req: Request, @Param("id") id: string) {
    return this.runs.like(req, id);
  }
  @Delete("posts/:id") remove(@Req() req: Request, @Param("id") id: string) {
    return this.runs.remove(req, id);
  }
  @Get("stats") stats(@Req() req: Request) {
    return this.runs.stats(req);
  }
}
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : (error as { status?: number })?.status === 413
          ? 413
          : 500;
    // Never log request bodies, cookies, OAuth tokens, emails or exception payloads.
    if (status === 500) console.error("runrun_api_failure");
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요."
            : status === 413
              ? "사진 크기가 너무 커요."
              : error instanceof HttpException
                ? error.message
                : "잘못된 요청입니다.",
      });
  }
}
export async function createApp(env: Env, auth: Auth) {
  @Module({
    controllers: [RunsController],
    providers: [
      RunsService,
      { provide: "ENV", useValue: env },
      { provide: "AUTH", useValue: auth },
    ],
  })
  class AppModule {}
  const server = express();
  server.disable("x-powered-by");
  server.set("trust proxy", false);
  server.use(express.json({ limit: "16kb", strict: true }));
  server.use(express.raw({ type: "multipart/form-data", limit: MAX_UPLOAD }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  app.useGlobalFilters(new SafeErrors());
  await app.init();
  return app.getHttpServer();
}
