import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TrustPay Naira to Cedi exchange";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#07100c",
          color: "#f7f3ec",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "72px 82px",
          width: "100%",
        }}
      >
        <div style={{ color: "#c9f45b", display: "flex", fontSize: 30, fontWeight: 700 }}>
          TRUSTPAY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#c9f45b", display: "flex", fontSize: 28 }}>
            NIGERIA ↔ GHANA
          </div>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 800, lineHeight: 1.05 }}>
            Exchange Naira<br />to Cedis.
          </div>
          <div style={{ color: "#c9d2c7", display: "flex", fontSize: 28 }}>
            Clear NGN to GHS quotes · Transparent fees · Secure settlement
          </div>
        </div>
        <div style={{ color: "#94a39a", display: "flex", fontSize: 24 }}>
          trustpay.xyz/exchange
        </div>
      </div>
    ),
    { ...size },
  );
}
