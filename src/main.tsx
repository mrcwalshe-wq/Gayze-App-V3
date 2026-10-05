import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {BrandChrome} from './components/BrandChrome';
import {IntentEdgeGlow} from './components/IntentEdgeGlow';
import './index.css';
import './brand-chrome.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <BrandChrome />
    <IntentEdgeGlow />
  </StrictMode>,
);
