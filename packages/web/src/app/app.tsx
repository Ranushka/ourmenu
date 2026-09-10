import { Route, Routes } from 'react-router-dom';
import { UploadPage } from '../pages/UploadPage';
import { MenuPage } from '../pages/MenuPage';
import { ManagePage } from '../pages/ManagePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
      <Route path="/m/:slug" element={<MenuPage />} />
      <Route path="/m/:slug/manage/:manageToken" element={<ManagePage />} />
    </Routes>
  );
}

export default App;
