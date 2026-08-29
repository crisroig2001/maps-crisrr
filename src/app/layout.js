import { Nunito } from 'next/font/google';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], weight: ['600', '700', '800'] });

export const metadata = {
  title: 'crisrr maps — mapa 3D colaborativo',
  description:
    'Un mapa 3D del mundo estilo cartoon que se colorea con los escaneos de la gente. Renderizado en tu GPU con datos de OpenStreetMap.',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗺️</text></svg>',
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
