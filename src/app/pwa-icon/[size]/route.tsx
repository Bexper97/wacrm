import { ImageResponse } from "next/og";

// Home-screen icon for the installed app (manifest + apple-touch-icon).
// Brand palette: deep violet ground, lime "B". Content stays inside the
// central 80% so the same image also works as a maskable icon.

export const runtime = "edge";

const ALLOWED = new Set([180, 192, 512]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!ALLOWED.has(size)) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14082F",
          color: "#B9F32E",
          fontSize: Math.round(size * 0.52),
          fontWeight: 800,
          letterSpacing: -2,
        }}
      >
        B
      </div>
    ),
    { width: size, height: size },
  );
}
