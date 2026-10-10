import { useEffect, useRef, useState } from "react";
import { CHAT_IMAGE_LIMITS } from "@shared/contracts/agent/imageLimits";

const CHAT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const CHAT_IMAGE_EXTENSION_TYPES = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["webp", "image/webp"], ["gif", "image/gif"],
]);

export function useChatInputImages({ modelConfig, isSending }) {
  const [inputImages, setInputImages] = useState([]);
  const inputImagesRef = useRef([]);
  const modelSupportsImages = Boolean(
    modelConfig?.model_options?.find((option) => option.id === modelConfig.model)?.supportsImageInput,
  );

  function replaceInputImages(next) {
    inputImagesRef.current = next;
    setInputImages(next);
  }

  function clearInputImages() {
    for (const image of inputImagesRef.current) URL.revokeObjectURL(image.previewUrl);
    replaceInputImages([]);
  }

  function addInputImages(files) {
    const candidates = [...(files || [])];
    if (!candidates.length) return;
    if (isSending) throw new Error("正在生成，暂时无法添加图片。");
    if (inputImagesRef.current.length + candidates.length > CHAT_IMAGE_LIMITS.maxImagesPerMessage) {
      throw new Error(`每条消息最多添加 ${CHAT_IMAGE_LIMITS.maxImagesPerMessage} 张图片。`);
    }
    const validated = candidates.map((file) => {
      const mediaType = resolveImageMediaType(file);
      if (!mediaType) throw new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片。");
      if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("图片内容为空。");
      if (file.size > CHAT_IMAGE_LIMITS.maxImageBytes) throw new Error("单张图片不能超过 20 MB。");
      return { file, mediaType };
    });
    const candidateBytes = validated.reduce((total, image) => total + image.file.size, 0);
    const currentBytes = inputImagesRef.current.reduce((total, image) => total + image.bytes, 0);
    if (currentBytes + candidateBytes > CHAT_IMAGE_LIMITS.maxMessageImageBytes) {
      throw new Error("每条消息的图片总计不能超过 200 MB。");
    }
    const admitted = validated.map(({ file, mediaType }) => ({
      localId: globalThis.crypto?.randomUUID?.() || `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name || "图片",
      mediaType,
      bytes: file.size,
      previewUrl: URL.createObjectURL(file),
    }));
    replaceInputImages([...inputImagesRef.current, ...admitted]);
  }

  function removeInputImage(localId) {
    const removed = inputImagesRef.current.find((image) => image.localId === localId);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    replaceInputImages(inputImagesRef.current.filter((image) => image.localId !== localId));
  }

  useEffect(() => {
    inputImagesRef.current = inputImages;
  }, [inputImages]);

  useEffect(() => () => {
    for (const image of inputImagesRef.current) URL.revokeObjectURL(image.previewUrl);
  }, []);

  return { inputImages, inputImagesRef, modelSupportsImages, addInputImages, removeInputImage, clearInputImages };
}

export async function encodeImageDraft(image) {
  const bytes = new Uint8Array(await image.file.arrayBuffer());
  const mediaType = detectImageMediaType(bytes);
  if (!mediaType) throw new Error("图片格式无法识别，仅支持 PNG、JPEG、WebP 和 GIF。");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return { mediaType, data: btoa(binary), name: image.name };
}

function detectImageMediaType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/)) return "image/gif";
  return "";
}

function resolveImageMediaType(file) {
  const declared = String(file.type || "").toLowerCase();
  if (CHAT_IMAGE_TYPES.has(declared)) return declared;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  return CHAT_IMAGE_EXTENSION_TYPES.get(extension) || "";
}
