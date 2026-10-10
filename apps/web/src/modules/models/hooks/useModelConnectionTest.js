import { useRef, useState } from "react";

const INITIAL_STEPS = [
  { id: "connection", label: "地址与密钥", hint: "", status: "running", detail: "" },
  { id: "models", label: "模型列表", hint: "", status: "pending", detail: "" },
  { id: "tools", label: "工具调用", hint: "tools", status: "pending", detail: "" },
];

export function useModelConnectionTest({ formRef, onProbeModels, onTestConnection, onNotify, onBeforeTest }) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTest, setConnectionTest] = useState({ status: "idle", message: "" });
  const [connectionTestDialog, setConnectionTestDialog] = useState(null);
  const testingRef = useRef(false);

  async function testConnection() {
    if (!onProbeModels || !onTestConnection || testingRef.current) return;
    testingRef.current = true;
    setTestingConnection(true);
    setConnectionTest({ status: "loading", message: "正在测试连接..." });
    onBeforeTest?.();

    const openedAt = Date.now();
    const snapshot = formRef.current;
    setConnectionTestDialog({
      openedAt,
      modelLabel: String(snapshot.model || "").trim(),
      finished: false,
      failed: false,
      completionMessage: "",
      steps: INITIAL_STEPS.map((step) => ({ ...step })),
    });

    function patchDialog(transform) {
      setConnectionTestDialog((current) => current?.openedAt === openedAt ? transform(current) : current);
    }

    function patchStep(id, patch) {
      patchDialog((current) => ({
        ...current,
        steps: current.steps.map((step) => step.id === id ? { ...step, ...patch } : step),
      }));
    }

    let testedConfig = snapshot;
    try {
      const models = await onProbeModels(snapshot);
      const modelIds = models.map((item) => String(item.id || item.name || "").trim()).filter(Boolean);
      if (!modelIds.length) throw new Error("连接成功，但接口没有返回可用模型。");
      const previousModel = String(snapshot.model || "").trim();
      const selectedModel = previousModel || modelIds[0];
      testedConfig = { ...snapshot, model: selectedModel, model_options: models };
      patchDialog((current) => ({ ...current, modelLabel: selectedModel }));
      patchStep("connection", { status: "passed" });
      patchStep("models", { status: "passed", detail: `${models.length} 个` });
      patchStep("tools", { status: "running" });
    } catch (error) {
      const message = errorMessage(error, "连接测试失败");
      patchStep("models", { status: "failed", detail: message });
      if (!String(snapshot.model || "").trim()) {
        patchStep("connection", { status: "failed", detail: message });
        patchDialog((current) => ({ ...current, finished: true, failed: true, completionMessage: "请选择要测试的模型。" }));
        setConnectionTest({ status: "error", message });
        finish();
        return;
      }
      patchStep("tools", { status: "running" });
    }

    try {
      await onTestConnection(testedConfig);
      patchStep("connection", { status: "passed" });
      patchStep("tools", { status: "passed", detail: "支持" });
      patchDialog((current) => ({
        ...current,
        finished: true,
        failed: false,
        completionMessage: "本次工具调用测试通过。",
      }));
      setConnectionTest({ status: "success", message: "连接测试成功" });
      onNotify?.("success", "连接与工具调用测试通过");
    } catch (error) {
      const message = errorMessage(error, "工具调用测试失败");
      patchStep("tools", { status: "failed", detail: message });
      patchDialog((current) => ({ ...current, steps: current.steps.map((step) => step.id === "connection" && step.status === "running" ? { ...step, status: "failed", detail: message } : step) }));
      patchDialog((current) => ({
        ...current,
        finished: true,
        failed: true,
        completionMessage: "本次工具调用测试未通过，请检查错误后重试。",
      }));
      setConnectionTest({ status: "error", message });
      onNotify?.("error", message);
    } finally {
      finish();
    }
  }

  function finish() {
    testingRef.current = false;
    setTestingConnection(false);
  }

  return {
    connectionTest,
    setConnectionTest,
    connectionTestDialog,
    dismissConnectionTest: () => setConnectionTestDialog(null),
    testingConnection,
    testConnection,
  };
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
