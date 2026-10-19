import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EternixPrototype } from './EternixPrototype';
import { startEnvironmentChanges } from '../../state/environmentStore';
import '../../styles.css';
import './eternix.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element in index.html');
}

// The shared day and weather clock. It changes the environment once every interval, on the home page and in the game.
startEnvironmentChanges();

createRoot(container).render(
  <StrictMode>
    <EternixPrototype />
  </StrictMode>,
);
