import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "永丰特8 朋友圈集赞送酒活动",
  description:
    "发朋友圈集赞，免费领永丰特8二锅头：42度纯粮酿造北京二锅头。集满10个赞送168ml装，集满20个赞送500ml装。",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 微信内置浏览器友好 */}
        <meta name="format-detection" content="telephone=no,email=no" />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>{children}</body>
    </html>
  );
}
