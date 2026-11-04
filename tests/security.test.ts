import { test } from "node:test";
import assert from "node:assert/strict";
import {
  postSchema,
  likeSchema,
  cursorSchema,
  trustedOrigin,
  koreaDate,
} from "../worker/src/security";
test("run input rejects future dates, invalid calendar dates, overflow, NaN, and injected keys", () => {
  const valid = {
    caption: "오늘도 달렸다.",
    distance: "5.2",
    duration: "30",
    runDate: koreaDate(),
  };
  assert.equal(postSchema.safeParse(valid).success, true);
  for (const change of [
    { distance: "NaN" },
    { distance: -1 },
    { distance: 301 },
    { duration: 1.2 },
    { duration: 4321 },
    { caption: "x".repeat(301) },
    { runDate: "2099-01-01" },
    { runDate: "2026-02-30" },
    { userId: "another-user" },
  ])
    assert.equal(postSchema.safeParse({ ...valid, ...change }).success, false);
});
test("CORS and CSRF use exact origins without wildcard or suffix matching", () => {
  const origin = "https://running.rootnode.kr";
  assert.equal(trustedOrigin(origin, origin, origin), true);
  for (const evil of [
    null,
    "null",
    "https://running.rootnode.kr.evil.test",
    "http://running.rootnode.kr",
    "https://evil.test",
    "https://blog.rootnode.kr",
  ])
    assert.equal(trustedOrigin(evil, origin, origin), false);
});
test("likes and pagination accept only bounded, typed values", () => {
  assert.equal(likeSchema.safeParse({ liked: true }).success, true);
  for (const value of ["true", 1, null, {}])
    assert.equal(likeSchema.safeParse({ liked: value }).success, false);
  assert.equal(
    likeSchema.safeParse({ liked: true, userId: "victim" }).success,
    false,
  );
  assert.equal(cursorSchema.safeParse("1'; DROP TABLE user;--").success, false);
});
