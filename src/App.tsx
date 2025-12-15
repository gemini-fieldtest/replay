import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const RealtimePage = lazy(() => import('./pages/RealtimePage').then(module => ({ default: module.RealtimePage })));
const ReplayPage = lazy(() => import('./pages/ReplayPage').then(module => ({ default: module.ReplayPage })));

function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <Routes>
        <Route path="/" element={<RealtimePage />} />
        <Route path="/replay" element={<ReplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
