import { createRoot } from "react-dom/client";
import App from "./app/windows/App.jsx";
import { initRendererAssets } from "./app/services/assets.js";
import { installResizePerformanceMode } from "./app/services/windowControls.js";
import { initializeAppearanceMode } from "./modules/appearance/index.js";
import "./app/windows/styles/index.css";

async function bootstrap() {
  installResizePerformanceMode();
  await Promise.all([
    initRendererAssets(),
    initializeAppearanceMode(),
  ]);
  const container = document.getElementById("eleckoi-root") || document.getElementById("root");
  if (!container) throw new Error("ElecKoi 页面容器不存在");
  globalThis.__ELECKOI_UNMOUNT__?.();
  const root = createRoot(container);
  globalThis.__ELECKOI_UNMOUNT__ = () => {
    root.unmount();
    delete globalThis.__ELECKOI_UNMOUNT__;
  };
  root.render(<App />);
}

globalThis.__ELECKOI_MOUNT__ = bootstrap;
void bootstrap();
