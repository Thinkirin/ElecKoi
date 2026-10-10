import {
  createChat as createChatSession,
  getChat,
  sendChatMessage,
} from "../api/chatApi.js";
import { encodeImageDraft } from "./useChatInputImages.js";

export async function runChatMessageSend(options) {
  const {
    event, input, inputImagesRef, inputFilesRef, isSending, modelConfig, modelSupportsImages, setStatus,
    requestRef, setIsSending, sessionId, chatCharacter, setSessionId, replaceChatMessages,
    setChatCharacter, normalizeLatestChatCharacter, refreshSessionsOnly, setInput, clearInputImages, clearInputFiles,
    setMessages, requestScrollToEnd, reconcileChatMessages,
    notify, restoreChatEntry, conversationModel,
  } = options;
  event?.preventDefault?.();
  const text = input.trim();
  const draftImages = [...inputImagesRef.current];
  const draftFiles = [...inputFilesRef.current];
  if ((!text && !draftImages.length && !draftFiles.length) || isSending) {
    return { kind: "error", text: isSending ? "当前聊天正在生成。" : "请输入消息。" };
  }
  if (!modelConfig?.id || !modelConfig.model?.trim()) {
    const message = "未配置可用的对话模型，请先前往“模型配置”添加模型和 API 密钥。";
    setStatus(message);
    notify?.("error", message);
    return { kind: "error", text: message };
  }
  if (!conversationModel) {
    const message = "DSH 聊天服务尚未就绪";
    setStatus(message);
    notify?.("error", message);
    return { kind: "error", text: message };
  }
  if (draftImages.length && !modelSupportsImages) {
    const message = "当前模型未声明图片输入能力，请切换模型或在模型设置中开启。";
    setStatus(message);
    return { kind: "error", text: message };
  }

  const controller = new AbortController();
  const activeRequest = { controller };
  requestRef.current = activeRequest;
  setIsSending(true);
  setStatus(draftImages.length ? "正在处理图片..." : "正在回复...");
  let targetSessionId = sessionId;

  try {
    const encodedImages = await Promise.all(draftImages.map(encodeImageDraft));
    throwIfAborted(controller.signal);
    if (!targetSessionId) {
      if (!chatCharacter.character_id) throw new Error("请先从角色设定中双击角色进入聊天");
      const characterName = chatCharacter.assistant_name || chatCharacter.character_name || "新对话";
      const created = await createChatSession(characterName, chatCharacter, { model: conversationModel });
      throwIfAborted(controller.signal);
      targetSessionId = created.chat.id;
      setSessionId(targetSessionId);
      replaceChatMessages(created.chat, "auto");
      setChatCharacter(normalizeLatestChatCharacter(created.chat));
      await refreshSessionsOnly({ keepSection: true });
      throwIfAborted(controller.signal);
    }

    restoreChatEntry?.(targetSessionId);
    activeRequest.conversationId = targetSessionId;

    setInput("");
    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRequest.requestId = requestId;
    const createdAt = new Date().toISOString();
    const userMessage = {
      id: `local-${Date.now()}`, conversationId: targetSessionId, role: "user", content: text,
      requestId,
      variableStateJson: '{}', created_at: createdAt,
      inputImageAttachments: draftImages.map((image, index) => ({
        attachmentId: image.localId, mediaType: encodedImages[index].mediaType, bytes: image.bytes, name: image.name,
        dataUrl: `data:${encodedImages[index].mediaType};base64,${encodedImages[index].data}`,
      })),
      inputFileAttachments: draftFiles.map((file) => ({
        attachmentId: file.attachmentId, name: file.name, bytes: file.bytes,
      })),
    };
    clearInputImages();
    clearInputFiles();
    const payload = {
      message: text,
      images: encodedImages,
      files: draftFiles.map((file) => file.receiptId || file.id),
      session_id: targetSessionId,
    };

    activeRequest.pendingUserMessage = userMessage;
    throwIfAborted(controller.signal);
    setMessages?.((items) => [...items, userMessage]);
    requestScrollToEnd("auto");
    const result = await sendChatMessage(payload, requestId, { model: conversationModel, signal: controller.signal });
    if (result.cancelled) {
      if (requestRef.current === null || requestRef.current === activeRequest) {
        reconcileChatMessages(result.chat);
      }
      if (requestRef.current === activeRequest) setStatus("已停止");
      return { kind: "success" };
    }
    if (requestRef.current !== activeRequest) return { kind: "success" };
    setSessionId(result.session_id);
    reconcileChatMessages(result.chat);
    setChatCharacter(normalizeLatestChatCharacter(result.chat || {}));
    await refreshSessionsOnly();
    if (requestRef.current !== activeRequest) return { kind: "success" };
    setStatus("回复完成");
    return { kind: "success" };
  } catch (error) {
    if (requestRef.current === activeRequest && !isAbortError(error)) {
      const message = getErrorMessage(error, "发送失败");
      setIsSending(false);
      setStatus(message);
      notify?.("error", message);
      let reconciled = false;
      if (targetSessionId) {
        try {
          const durable = await getChat(targetSessionId, { model: conversationModel });
          if (requestRef.current === activeRequest) {
            reconcileChatMessages(durable.chat);
            setChatCharacter(normalizeLatestChatCharacter(durable.chat || {}));
            reconciled = true;
          }
        } catch {
          // Keep the original send failure visible if refreshing durable state also fails.
        }
      }
      if (requestRef.current !== activeRequest) return { kind: "success" };
      if (!reconciled) setStatus("发送失败，且无法刷新聊天记录");
    }
    return isAbortError(error)
      ? { kind: "success" }
      : { kind: "error", text: getErrorMessage(error, "发送失败") };
  } finally {
    if (requestRef.current === activeRequest) {
      requestRef.current = null;
      setIsSending(false);
    }
  }
}

export function stopChatMessageSend({
  requestRef,
  setIsSending,
  setStatus,
  notify,
  cancelRequest,
}) {
  const activeRequest = requestRef.current;
  if (!activeRequest || activeRequest.stopping) return false;

  activeRequest.stopping = true;
  requestRef.current = null;
  activeRequest.controller?.abort?.();
  setIsSending?.(false);
  setStatus("已停止");
  if (!activeRequest.requestId || typeof cancelRequest !== "function") {
    return true;
  }

  void cancelRequest(activeRequest.requestId).catch((error) => {
    const message = getErrorMessage(error, "停止生成失败");
    if (requestRef.current === null) setStatus(message);
    notify?.("error", message);
  });
  return true;
}

export function getErrorMessage(error, fallback) {
  const raw = typeof error === "string" ? error : error?.message;
  return raw?.trim() || fallback;
}

export function isAbortError(error) {
  return error?.name === "AbortError" || error?.message === "生成已停止";
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("生成已停止");
  error.name = "AbortError";
  throw error;
}
