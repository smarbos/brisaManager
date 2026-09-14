import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfirmationPage } from './confirmation/ConfirmationPage';
import { PageContainer } from './ui';

function HomePlaceholder() {
  return (
    <PageContainer>
      <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa de Mar del Plata</h1>
      <p className="mt-2 text-text-muted">Guest portal coming soon.</p>
    </PageContainer>
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
