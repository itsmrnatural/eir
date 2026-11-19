import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { captureDemoKey } from './lib/demoTap.js';
import { queryClient } from './lib/queryClient.js';
import './styles.css';

// `npm run dev:mock` runs Vite in "mock" mode: an MSW service worker answers every /api/v1 call.
async function enableMocking() {
  if (import.meta.env.MODE !== 'mock') return;
  const { worker } = await import('./mocks/browser.js');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

captureDemoKey(); // Demo only: ?demo=<key> enables the phone card reader; must run before the router redirects

enableMocking().then(() => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
