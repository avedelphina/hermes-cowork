import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing keeps the document URL fixed at index.html: the main
        process can then verify it exactly, and a reload never lands on a
        nonexistent file:///<route>. */}
    <Router hook={useHashLocation}>
      <App />
    </Router>
  </StrictMode>,
);
