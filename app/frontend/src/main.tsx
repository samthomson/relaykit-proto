import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './contexts/ToastContext';
import { DokployProvider } from './contexts/DokployContext';
import { RefreshServicesProvider } from './contexts/RefreshServicesContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <DokployProvider>
        <RefreshServicesProvider>
          <App />
        </RefreshServicesProvider>
      </DokployProvider>
    </ToastProvider>
  </React.StrictMode>
);

