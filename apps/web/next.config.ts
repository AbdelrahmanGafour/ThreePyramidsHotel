import type { NextConfig } from "next";
import { resolveMediaRemotePattern } from "./shared/config/mediaPublicBaseUrl";

// `MEDIA_PUBLIC_BASE_URL` is read here, once, at build/dev-start time — the
// only place this app's Next configuration needs to know where admin-uploaded
// media is served from. It is deliberately not `NEXT_PUBLIC_`: nothing in
// client JavaScript reads it, because the actual image URL a browser fetches
// comes from the API's own response, not from this variable. This variable
// exists only so `next/image` has a remote origin to allow and optimize.
//
// Absent, the build must still succeed and simply carries no media remote
// pattern — a development environment with no media host configured yet is a
// normal, working state, not a build failure. A malformed value is not: it is
// let through as a startup error rather than silently ignored, the same way a
// malformed `API_BASE_URL` already behaves in `apiBaseUrl.ts`.
const mediaRemotePattern = resolveMediaRemotePattern(process.env.MEDIA_PUBLIC_BASE_URL);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Only ever this one entry, or none. No `images.domains` (deprecated),
    // no blanket `/**` pathname, and no `unoptimized` — a configured media
    // host still gets Next's own resizing and format negotiation.
    remotePatterns: mediaRemotePattern ? [mediaRemotePattern] : [],
  },
  experimental: {
    serverActions: {
      // A raw transport ceiling, not a second "allowed image size" rule. The
      // API's own limit stays exactly 8 MiB (`MAX_SOURCE_BYTES`); a Server
      // Action carries an uploaded file as multipart form data, which adds a
      // small, real amount of boundary/header overhead on top of the file's
      // own bytes. 9 MiB leaves that headroom so a genuinely 8 MiB image is
      // never rejected by Next before the API ever gets to judge it. Raising
      // this number cannot make an oversized image acceptable — the API
      // still answers 413 IMAGE_TOO_LARGE for anything past its own rule.
      bodySizeLimit: "9mb",
    },
  },
};

export default nextConfig;
