import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PhoneView from './views/PhoneView';
import ComputerView from './views/ComputerView';
import TVView from './views/TVView';
import HomeView from './views/HomeView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/phone" element={<PhoneView />} />
        <Route path="/computer" element={<ComputerView />} />
        <Route path="/tv" element={<TVView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
