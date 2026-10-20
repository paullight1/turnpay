import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TrustPay everyday payments, airtime and data in Nigeria";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#f8f7f4",
          color: "#171717",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "72px 82px",
          width: "100%",
        }}
      >
        <div style={{ color: "#dc2626", display: "flex", fontSize: 30, fontWeight: 700 }}>
          TRUSTPAY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#dc2626", display: "flex", fontSize: 28 }}>
            MADE FOR NIGERIA
          </div>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 800, lineHeight: 1.05 }}>
            Everyday payments.<br />One simple app.
          </div>
          <div style={{ color: "#66625f", display: "flex", fontSize: 28 }}>
            Pay bills · Buy airtime and data · Coming soon
          </div>
        </div>
        <div style={{ color: "#8b8580", display: "flex", fontSize: 24 }}>
          trustpay
        </div>
      </div>
    ),
    { ...size },
  );
}
