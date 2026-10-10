import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeModelSelection, resolveModelConfig } from "../model/chatModelSelection.js";

const DEFAULT_SELECTION = {
  capability: "chat",
  configId: "",
  model: "",
};

function errorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) return error;
  if (error?.message?.trim()) return error.message;
  return fallback;
}

function fromDshSelection(selection = {}) {
  return normalizeModelSelection({
    capability: "chat",
    configId: selection.provider || "",
    model: selection.model || "",
  });
}

export function useActiveChatModel({ conversations, conversationId, modelConfigs, setStatus }) {
  const [modelSelection, setModelSelection] = useState(DEFAULT_SELECTION);
  const generationRef = useRef(0);
  const configKey = JSON.stringify((modelConfigs || []).map(config => [config.id, config.model,
    config.enabled, config.credentialConfigured, (config.model_options || []).map(option => option.id)]));
  const modelConfig = useMemo(
    () => resolveModelConfig(modelConfigs, modelSelection),
    [modelConfigs, modelSelection.configId, modelSelection.model],
  );

  async function selectChatModel(nextSelection) {
    if (!conversations) throw new Error("DSH 聊天服务尚未就绪。");
    const generation = ++generationRef.current;
    const previous = modelSelection;
    const next = normalizeModelSelection(nextSelection);
    setModelSelection(next);
    try {
      const selected = await conversations.selectModel("", {
        provider: next.configId,
        model: next.model,
      });
      if (generation === generationRef.current) setModelSelection(fromDshSelection(selected));
    } catch (error) {
      if (generation === generationRef.current) {
        setModelSelection(previous);
        setStatus(errorMessage(error, "模型选择保存失败"));
      }
      throw error;
    }
  }

  useEffect(() => {
    const generation = ++generationRef.current;
    const fallback = (modelConfigs || []).find(config => config.enabled !== false
      && config.credentialConfigured !== false && (config.model || config.model_options?.[0]?.id));
    const defaultSelection = fallback ? normalizeModelSelection({ configId: fallback.id,
      model: fallback.model || fallback.model_options[0].id }) : DEFAULT_SELECTION;
    if (!conversations) {
      setModelSelection(defaultSelection);
      return;
    }
    setModelSelection(DEFAULT_SELECTION);
    conversations.readModelSelection("").then(async (selection) => {
      if (generation !== generationRef.current) return;
      const current = fromDshSelection(selection);
      if (resolveModelConfig(modelConfigs, current) || !fallback) {
        setModelSelection(current);
        return;
      }
      const selected = await conversations.selectModel("", {
        provider: defaultSelection.configId, model: defaultSelection.model,
      });
      if (generation === generationRef.current) setModelSelection(fromDshSelection(selected));
    }).catch((error) => {
      if (generation === generationRef.current) setStatus(errorMessage(error, "模型选择读取失败"));
    });
  }, [conversations, setStatus, configKey]);

  useEffect(() => {
    if (!conversations?.subscribeModelSelection) return undefined;
    return conversations.subscribeModelSelection(() => {
      setModelSelection(fromDshSelection(conversations.getModelSelectionSnapshot()));
    });
  }, [conversations]);

  return { modelConfig, modelSelection, selectChatModel };
}
