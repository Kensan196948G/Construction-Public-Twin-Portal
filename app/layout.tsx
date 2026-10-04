import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "工事みえるマップ 3D Beta | Construction Public Twin Portal",
  description:
    "公共工事を「位置・目的・工期・完成像・交通規制・生活影響」の文脈で住民が理解できるWebアプリ（MVP）。",
  applicationName: "工事みえるマップ 3D Beta",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f8fa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        {/*
          デザイン契約のタイポグラフィ。ビルド時にネットワークへ依存しないよう
          next/font ではなく <link> で読み込み、未取得時はシステムフォントへ
          フォールバックする（globals.css の --font-body / --font-mono）。
          App Router では <link> は全ページで共有されるため、
          no-page-custom-font の警告はここでは該当しない。
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
