import type { MetadataRoute } from "next";

// Lets phones "install" BEX to the home screen and open it full-screen,
// without browser chrome, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BEX",
    short_name: "BEX",
    description: "BEX — central de conversas do WhatsApp.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#14082F",
    theme_color: "#14082F",
    lang: "pt-BR",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
