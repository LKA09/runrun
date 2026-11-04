/** Bounded JPEG marker parser. Keeps image coding data, drops APP/EXIF/XMP/COM
 * and trailing bytes. Does not decompress attacker-controlled images in a Worker.
 * The output is served only as image/jpeg with nosniff and a sandbox CSP.
 */
export function sanitizeJpeg(input: Uint8Array): Uint8Array {
  if (input[0] !== 0xff || input[1] !== 0xd8) throw new Error("Not JPEG");
  const chunks: Uint8Array[] = [input.subarray(0, 2)];
  let at = 2,
    frame = false,
    scan = false,
    segments = 0,
    total = 2;
  const keep = (start: number, end: number) => {
    const part = input.subarray(start, end);
    chunks.push(part);
    total += part.length;
  };
  while (at < input.length && ++segments <= 256) {
    const start = at;
    if (input[at++] !== 0xff) throw new Error("Invalid marker");
    while (input[at] === 0xff) at++;
    const marker = input[at++];
    if (marker === 0xd9) {
      if (!frame || !scan) throw new Error("Incomplete image");
      keep(start, at);
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    }
    if (at + 2 > input.length) throw new Error("Truncated marker");
    const size = input[at] * 256 + input[at + 1],
      end = at + size;
    if (size < 2 || end > input.length)
      throw new Error("Invalid segment length");
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || size < 11 || input[at + 2] !== 8)
        throw new Error("Unsupported frame");
      const h = input[at + 3] * 256 + input[at + 4],
        w = input[at + 5] * 256 + input[at + 6],
        components = input[at + 7];
      if (
        !w ||
        !h ||
        w > 1600 ||
        h > 1600 ||
        w * h > 2_000_000 ||
        ![1, 3].includes(components) ||
        size !== 8 + 3 * components
      )
        throw new Error("Image dimensions exceed limit");
      frame = true;
    } else if (marker === 0xda) {
      if (!frame || size < 6) throw new Error("Invalid scan");
      scan = true;
      keep(start, end);
      at = end;
      const entropyStart = at;
      while (at < input.length) {
        if (input[at] !== 0xff) {
          at++;
          continue;
        }
        let next = at + 1;
        while (input[next] === 0xff) next++;
        if (
          input[next] === 0x00 ||
          (input[next] >= 0xd0 && input[next] <= 0xd7)
        ) {
          at = next + 1;
          continue;
        }
        break;
      }
      keep(entropyStart, at);
      continue;
    } else if (
      ![0xc4, 0xdb, 0xdd, 0xfe].includes(marker) &&
      !(marker >= 0xe0 && marker <= 0xef)
    )
      throw new Error("Unsupported JPEG segment");
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe)
      keep(start, end);
    at = end;
  }
  throw new Error("Incomplete image");
}
