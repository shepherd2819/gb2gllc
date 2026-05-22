import { ImageResponse } from "next/og";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#1C1E1B",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px",
          position: "relative",
        }}
      >
        {/* Top rule */}
        <div style={{ position: "absolute", top: "0", left: "80px", right: "80px", height: "1px", background: "rgba(201,169,97,0.25)", display: "flex" }} />

        {/* Monogram */}
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: "32px" }}>
          <span style={{ fontSize: "100px", fontWeight: 500, color: "#FAF6EC", letterSpacing: "-3px", fontFamily: "system-ui, sans-serif" }}>gb</span>
          <span style={{ fontSize: "100px", fontWeight: 400, color: "#C9A961", fontStyle: "italic", fontFamily: "Georgia, serif", margin: "0 2px" }}>2</span>
          <span style={{ fontSize: "100px", fontWeight: 500, color: "#FAF6EC", letterSpacing: "-3px", fontFamily: "system-ui, sans-serif" }}>g</span>
          <span style={{ fontSize: "20px", fontWeight: 400, color: "rgba(250,246,236,0.35)", fontFamily: "monospace", marginLeft: "10px", marginBottom: "52px" }}>LLC</span>
        </div>

        {/* Tagline */}
        <div style={{ display: "flex", fontSize: "26px", color: "rgba(250,246,236,0.55)", fontWeight: 300, letterSpacing: "0.01em", fontFamily: "system-ui, sans-serif" }}>
          Software founded in Faith.
        </div>

        {/* URL */}
        <div style={{ position: "absolute", bottom: "52px", right: "80px", display: "flex", fontSize: "13px", color: "rgba(250,246,236,0.25)", fontFamily: "monospace", letterSpacing: "0.08em" }}>
          gb2gllc.com
        </div>

        {/* Bottom rule */}
        <div style={{ position: "absolute", bottom: "0", left: "80px", right: "80px", height: "1px", background: "rgba(201,169,97,0.25)", display: "flex" }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
