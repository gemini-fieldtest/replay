import { Routes, Route, Navigate } from 'react-router-dom';

import { RealtimePage } from './pages/RealtimePage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<RealtimePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
