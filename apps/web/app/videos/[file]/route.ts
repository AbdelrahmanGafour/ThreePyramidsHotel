import { open, stat } from "node:fs/promises";
import path from "node:path";

// The hero videos are too large for some upload paths, so a host can keep them
// outside the deployed folder: MEDIA_LOCAL_DIR/videos/<name>. A file under
// public/videos, when present, is served by Next before this route is reached.
const FILE_NAME = /^[a-z0-9][a-z0-9-]*\.(mp4|webm|webp)$/i;
const TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", webp: "image/webp" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;

  if (!FILE_NAME.test(file) || !process.env.MEDIA_LOCAL_DIR) {
    return new Response("Not found", { status: 404 });
  }

  const target = path.join(path.resolve(process.env.MEDIA_LOCAL_DIR, "videos"), file);

  try {
    const { size } = await stat(target);
    const type = TYPES[file.split(".").pop()!.toLowerCase()];
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");

    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(size - Number(range[2]), 0);
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      status = 206;
    }

    const handle = await open(target);
    const buffer = Buffer.alloc(end - start + 1);
    await handle.read(buffer, 0, buffer.length, start);
    await handle.close();

    const headers: Record<string, string> = {
      "content-type": type,
      "content-length": String(buffer.length),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
    };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;

    return new Response(new Uint8Array(buffer), { status, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
