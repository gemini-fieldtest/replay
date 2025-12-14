import { Routes, Route, Navigate } from 'react-router-dom';

import { RealtimePage } from './pages/RealtimePage';
import { ReplayPage } from './pages/ReplayPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<RealtimePage />} />
      <Route path="/replay" element={<ReplayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
