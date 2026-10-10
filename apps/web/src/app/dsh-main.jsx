import App from './windows/App.jsx';
import { initRendererAssets } from './services/assets.js';
import { installResizePerformanceMode } from './services/windowControls.js';
import { initializeAppearanceMode } from '../modules/appearance/index.js';
import './windows/styles/index.css';

installResizePerformanceMode();
Promise.all([initRendererAssets(), initializeAppearanceMode()]).then(() => {
  globalThis.__ELECKOI_DSH_APP__ = App;
  globalThis.dispatchEvent(new Event('eleckoi:dsh-app-ready'));
}).catch((error) => {
  globalThis.dispatchEvent(new CustomEvent('eleckoi:dsh-app-failed', {
    detail: error instanceof Error ? error.message : String(error)
  }));
});
