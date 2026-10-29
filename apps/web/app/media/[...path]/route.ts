import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves admin-uploaded images from disk when the API stores them locally
// (MEDIA_DRIVER=local). The key shape is fixed — media/<uuid>.webp — so
// nothing a caller sends can name any other file.
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: segments } = await params;

  if (process.env.MEDIA_DRIVER !== "local" || segments.length !== 1 || !FILE_NAME.test(segments[0])) {
    return new Response("Not found", { status: 404 });
  }

  const root = path.resolve(process.env.MEDIA_LOCAL_DIR || "uploads", "media");

  try {
    const bytes = await readFile(path.join(root, segments[0]));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
