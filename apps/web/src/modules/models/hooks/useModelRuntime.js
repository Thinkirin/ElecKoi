import { useEffect, useState } from "react";
import { modelOptionsKey } from "../model/modelProviderCatalog.js";

export function useModelRuntime({ modelCatalog, setStatus }) {
  const [modelConfigs, setModelConfigs] = useState([]);
  const [modelOptionsByKey, setModelOptionsByKey] = useState({});

  useEffect(() => {
    const update = () => {
      const snapshot = modelCatalog.getSnapshot();
      if (snapshot.status === "ready") {
        const configs = snapshot.configs.map((item) => ({ ...item }));
        setModelConfigs(configs);
        setModelOptionsByKey(Object.fromEntries(configs.map((config) => [
          modelOptionsKey(config),
          Array.isArray(config.model_options) ? config.model_options : [],
        ])));
      } else if (snapshot.status === "error") {
        setStatus(snapshot.error);
      }
    };
    const stop = modelCatalog.subscribe(update);
    update();
    return stop;
  }, [modelCatalog, setStatus]);

  async function loadModelOptions(config = modelConfigs[0]) {
    await modelCatalog.refresh();
    if (!config) return [];
    const current = modelCatalog.getSnapshot().configs.find((item) => item.id === config.id);
    return current?.model_options || [];
  }

  return {
    modelConfigs,
    modelOptionsByKey,
    loadModelOptions,
  };
}
