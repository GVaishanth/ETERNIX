import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installDevHooks } from './diagnostics/devHooks';
import { installRuntimeErrorCapture } from './diagnostics/errorCapture';
import './styles.css';

// Runtime error capture is observe-only and exists only in development builds.
if (import.meta.env.DEV) {
  installRuntimeErrorCapture(window);
  installDevHooks(window);
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
