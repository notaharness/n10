import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { BOOT_MARKS, markOnce } from './lib/perf.js';
import { initTheme } from './lib/theme.js';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

markOnce(BOOT_MARKS.boot);

// Apply the persisted theme class before the first paint.
initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Outside every provider, so whatever throws while rendering, the
// window shows the error rather than going blank.
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="n10 hit an error drawing this window.">
      <App />
    </ErrorBoundary>
  </StrictMode>
);
