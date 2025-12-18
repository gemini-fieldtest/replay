import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const RealtimePage = React.lazy(() => import('./pages/RealtimePage').then(module => ({ default: module.RealtimePage })));
const ReplayPage = React.lazy(() => import('./pages/ReplayPage').then(module => ({ default: module.ReplayPage })));

function App() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-gray-900 text-white">Loading...</div>}>
      <Routes>
        <Route path="/" element={<RealtimePage />} />
        <Route path="/replay" element={<ReplayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
