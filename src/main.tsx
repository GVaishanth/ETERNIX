import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startEnvironmentChanges } from './state/environmentStore';
import { installDevHooks } from './diagnostics/devHooks';
import { installRuntimeErrorCapture } from './diagnostics/errorCapture';
import { StartupBoundary } from './ui/StartupBoundary';
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

// The shared day and weather clock. It changes the environment once every interval, on the home page and in the game.
startEnvironmentChanges();

createRoot(container).render(
  <StrictMode>
    <StartupBoundary>
      <App />
    </StartupBoundary>
  </StrictMode>,
);
