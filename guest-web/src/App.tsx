import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfirmationPage } from './confirmation/ConfirmationPage';

function HomePlaceholder() {
  return (
    <main className="container">
      <h1>La Brisa de Mar del Plata</h1>
      <p>Guest portal coming soon.</p>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePlaceholder />} />
        <Route path="/r/:token" element={<ConfirmationPage />} />
      </Routes>
    </BrowserRouter>
  );
}
