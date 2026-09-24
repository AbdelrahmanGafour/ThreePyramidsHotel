export type PackageMedia = {
  image: string;
  imageAlt: string;
  position: string;
  isFallback: boolean;
};

const FALLBACK_MEDIA: PackageMedia = {
  image: "/images/placeholders/material-detail.webp",
  imageAlt: "",
  position: "50% 50%",
  isFallback: true,
};

// Presentation data stays local to the website. Backend package slugs that do
// not have an approved image mapping intentionally fall back instead of
// becoming catalogue/data errors.
const PACKAGE_MEDIA: Record<string, Omit<PackageMedia, "isFallback">> = {
  "dawn-plateau-and-the-museum": {
    image: "/images/placeholders/giza-suite-terrace.webp",
    imageAlt: "Warm dawn light over the Giza plateau",
    position: "29% 50%",
  },
  "into-the-desert-stillness": {
    image: "/images/placeholders/material-detail.webp",
    imageAlt: "Warm stone textures inspired by the desert",
    position: "50% 50%",
  },
  "rooftop-evenings-after-dark": {
    image: "/images/placeholders/rooftop-dining.webp",
    imageAlt: "Rooftop dining terrace at nightfall",
    position: "58% 48%",
  },
};

export function getPackageMedia(slug: string): PackageMedia {
  const media = PACKAGE_MEDIA[slug];
  return media ? { ...media, isFallback: false } : { ...FALLBACK_MEDIA };
}
