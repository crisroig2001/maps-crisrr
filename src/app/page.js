'use client';

import dynamic from 'next/dynamic';

const Mundo = dynamic(() => import('../components/Mundo'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#5c6875', fontWeight: 700 }}>
      Cargando el mundo…
    </div>
  ),
});

export default function Home() {
  return <Mundo />;
}
