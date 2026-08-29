import { Nunito } from 'next/font/google';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], weight: ['600', '700', '800'] });

export const metadata = {
  title: 'crisrr maps — mapa 3D colaborativo',
  description:
    'Un mapa 3D del mundo estilo cartoon que se colorea con los escaneos de la gente. Renderizado en tu GPU con datos de OpenStreetMap.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'crisrr maps',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#cfe8f4',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className={nunito.className}>{children}</body>
    </html>
  );
}
