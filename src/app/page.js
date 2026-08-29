'use client';

import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('../components/MapView'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#5c6875', fontWeight: 700 }}>
      Cargando el mapa…
    </div>
  ),
});

export default function Home() {
  return <MapView />;
}
