import { ImageResponse } from "next/og";

// Browser-tab icon: the BEX mark — WhatsApp-green rounded square with a
// white "B". Next.js renders this at build time and auto-injects
// <link rel="icon"> into <head>.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#00a884",
          borderRadius: 7,
          color: "#ffffff",
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        B
      </div>
    ),
    { ...size },
  );
}
