import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {BrandChrome} from './components/BrandChrome';
import {IntentEdgeGlow} from './components/IntentEdgeGlow';
import {AppErrorBoundary, installChunkReload} from './components/AppErrorBoundary';
import './index.css';
import './brand-chrome.css';
import './gayze-premium-intent.css';
import './discovery-premium.css';
import './product-design.css';
import './map-chrome-refinement.css';
import './gayze-design-pass.css';
import './peek-premium.css';
import './snack-premium.css';

installChunkReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <BrandChrome />
      <IntentEdgeGlow />
    </AppErrorBoundary>
  </StrictMode>,
);
