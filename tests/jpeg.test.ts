import { test } from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { sanitizeJpeg } from "../worker/src/jpeg";
const data = jpeg.encode(
  { data: Buffer.alloc(4 * 4 * 4, 128), width: 4, height: 4 },
  80,
).data;
test("JPEG sanitizer strips EXIF/GPS, comments and trailing payload while retaining a decodable image", () => {
  const payload = Buffer.from("GPSLatitude=37.123;GPSLongitude=127.456");
  const marker = Buffer.from([255, 225, 0, payload.length + 2]);
  const comment = Buffer.from([255, 254, 0, 6, 116, 101, 115, 116]);
  const input = Buffer.concat([
    data.subarray(0, 2),
    marker,
    payload,
    comment,
    data.subarray(2),
    Buffer.from("<script>evil</script>"),
  ]);
  const clean = sanitizeJpeg(input);
  assert.equal(Buffer.from(clean).includes(payload), false);
  assert.equal(Buffer.from(clean).includes(Buffer.from("<script>")), false);
  assert.equal(jpeg.decode(clean).width, 4);
});
test("JPEG sanitizer rejects bad signatures, truncation, oversized dimensions and invalid segments", () => {
  for (const input of [
    Buffer.from("<svg/>"),
    data.subarray(0, data.length - 2),
    Buffer.from([255, 216, 255, 225, 255, 255]),
  ])
    assert.throws(() => sanitizeJpeg(input));
  const bomb = Buffer.from(data);
  const marker = bomb.indexOf(Buffer.from([255, 192]));
  assert.ok(marker > 0);
  bomb[marker + 5] = 0xff;
  bomb[marker + 6] = 0xff;
  assert.throws(() => sanitizeJpeg(bomb));
});
