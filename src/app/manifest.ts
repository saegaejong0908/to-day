import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const buildVersion = process.env.NEXT_PUBLIC_BUILD_TIME ?? "dev";
  return {
    name: "to day",
    short_name: "to day",
    description: "생활습관 + 집중 관리 웹앱",
    start_url: `/?v=${buildVersion}`,
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon-192-v2.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        src: "/icon-512-v2.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
  };
}
