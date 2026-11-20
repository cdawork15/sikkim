import { lazy, Suspense } from 'react';
import { DemoApp } from './DemoApp';
const ConnectedApp = lazy(() =>
  import('./connected/ConnectedApp').then((module) => ({
    default: module.ConnectedApp,
  })),
);
export function App() {
  if (import.meta.env.VITE_DATA_MODE === 'demo') return <DemoApp />;
  return (
    <Suspense
      fallback={
        <main className="page interior-page">
          <h1>Sikkim Experiences</h1>
          <p role="status">Loading…</p>
        </main>
      }
    >
      <ConnectedApp />
    </Suspense>
  );
}
