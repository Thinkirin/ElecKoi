import { ArrowClockwise, CircleNotch, Stop, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useSharedFrontendRuntime } from '../hooks/useSharedFrontendRuntime.js';
import { assetSrc } from '../../app/services/assets.js';
import './generated-chat-images.css';
import { ChatImagePreview } from './ChatImagePreview.jsx';

export async function invokeChatImageAction(runtime, method, params) {
  if (!runtime?.remote?.eleckoiAuthorPlugins?.invoke || !runtime?.sdk?.unwrapRemote) throw new Error('图片生成服务尚未就绪。');
  return runtime.sdk.unwrapRemote(await runtime.remote.eleckoiAuthorPlugins.invoke({ method, params }));
}

export function agentMessageImageSize(width, height) {
  if (!(width > 0) || !(height > 0)) return { width: 240, height: 240, objectPosition: "center" };
  const naturalRatio = width / height;
  const ratio = Math.min(4, Math.max(0.25, naturalRatio));
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
  const scale = Math.min(1, width / box.width, height / box.height);
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: naturalRatio < 0.25 ? "center top" : naturalRatio > 4 ? "left center" : "center",
  };
}

export function ChatImageGallery({ images = [], conversationId = "", messageId = "", compact = false, agentMessage = false, generated = false,
  onRemove, loadImage, runtime: suppliedRuntime, onRegenerateImage, onCancelImage }) {
  const shared = useSharedFrontendRuntime();
  const runtime = suppliedRuntime ?? shared.runtime;
  if (!images.length) return null;
  const agentVariant = agentMessage ? images.length > 1 ? "tile" : "single" : "";
  return (
    <div className={`chat-image-gallery${compact ? " compact" : ""}${agentMessage ? " agent-message-images" : ""}`} aria-label={compact ? "待发送图片" : "消息图片"}>
      {images.map((image) => (
        <ChatImage
          key={image.id || image.localId || image.attachmentId || image.renderKey}
          image={image}
          conversationId={conversationId}
          compact={compact}
          agentVariant={agentVariant}
          onRemove={onRemove}
          loadImage={loadImage}
          messageId={messageId}
          generated={generated}
          runtime={runtime}
          onRegenerateImage={onRegenerateImage}
          onCancelImage={onCancelImage}
        />
      ))}
    </div>
  );
}

function ChatImage({ image: suppliedImage, conversationId, compact, agentVariant, onRemove, loadImage, messageId, generated, runtime, onRegenerateImage, onCancelImage }) {
  const [image, setImage] = useState(suppliedImage);
  const [source, setSource] = useState(assetSrc(suppliedImage.previewUrl || suppliedImage.dataUrl || suppliedImage.url || ""));
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [action, setAction] = useState('');
  const liveRef = useRef(true), operationRef = useRef(0);
  const [naturalSize, setNaturalSize] = useState(null);
  const fit = agentVariant === "single"
    ? agentMessageImageSize(image.width || naturalSize?.width, image.height || naturalSize?.height)
    : null;

  useEffect(() => { setImage(suppliedImage); }, [suppliedImage]);
  useEffect(() => { setActionError(''); }, [suppliedImage.status, suppliedImage.generationStatus, suppliedImage.renderKey, suppliedImage.errorMessage]);
  useEffect(() => {
    liveRef.current = true;
    setAction(''); setActionError('');
    return () => { liveRef.current = false; operationRef.current++; };
  }, [conversationId, messageId, suppliedImage.id]);
  useEffect(() => {
    if (!generated || !runtime?.adapter?.on) return undefined;
    return runtime.adapter.on('image.state.changed', payload => {
      if (payload.conversationId !== conversationId || payload.messageId !== messageId) return;
      const value = payload.image || payload;
      if (value.id === suppliedImage.id) { setImage(value); setActionError(''); }
    });
  }, [runtime, generated, conversationId, messageId, suppliedImage.id]);

  useEffect(() => {
    const immediateSource = assetSrc(image.previewUrl || image.dataUrl || image.url || "");
    setFailed(false);
    if (immediateSource) {
      setSource(immediateSource);
      return undefined;
    }
    if (!conversationId || !image.attachmentId) {
      setSource("");
      return undefined;
    }
    let active = true;
    if (!loadImage) { setFailed(true); return undefined; }
    setSource("");
    loadImage(conversationId, image)
      .then((url) => { if (active) setSource(url); })
      .catch(error => { if (active) { setFailed(true); setActionError(error.message || String(error)); } });
    return () => { active = false; };
  }, [conversationId, image.attachmentId, image.dataUrl, image.previewUrl, image.url, image.renderKey, loadImage]);

  async function runAction(kind) {
    const token = ++operationRef.current;
    const params = { conversationId, messageId, id: image.id };
    const previous = image;
    setAction(kind); setActionError('');
    if (kind === 'regenerate') setImage({ ...image, status: 'Generating', generationStatus: 'Generating', errorMessage: '' });
    try {
      const result = kind === 'regenerate'
        ? await (onRegenerateImage ? onRegenerateImage(params) : invokeChatImageAction(runtime, 'media.regenerateImage', params))
        : await (onCancelImage ? onCancelImage(params) : invokeChatImageAction(runtime, 'media.cancelImage', params));
      if (!liveRef.current || token !== operationRef.current) return;
      if (kind === 'cancel') {
        if (result !== true) throw new Error('图片任务未被取消，请查看当前状态。');
        setImage(current => ({ ...current, status: 'Cancelled', generationStatus: 'Cancelled' }));
      } else {
        if (!result?.id || !result.status && !result.generationStatus) throw new Error('图片服务返回的数据不完整。');
        setImage(result);
      }
    } catch (error) {
      if (!liveRef.current || token !== operationRef.current) return;
      if (kind === 'regenerate') setImage(previous);
      setActionError(error.message || String(error));
    } finally { if (liveRef.current && token === operationRef.current) setAction(''); }
  }

  const label = image.name || "图片";
  const status = image.generationStatus || image.status;
  const generating = generated && status === 'Generating';
  const failedGeneration = generated && status === 'Failed';
  const cancelled = generated && status === 'Cancelled';
  const canAct = Boolean(generated && conversationId && messageId && image.id);
  return (
    <figure
      className={`chat-image-item${failed ? " failed" : ""}${agentVariant ? ` agent-${agentVariant}` : ""}${generated ? ' generated-chat-image' : ''}`}
      style={fit ? { width: `${fit.width}px`, aspectRatio: `${fit.width} / ${fit.height}` } : undefined}
    >
      {source ? <img src={source} alt={label} draggable="false" role="button" tabIndex={0} aria-label={`查看${label}`} onClick={() => setPreviewOpen(true)} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPreviewOpen(true); }
      }} style={fit ? { objectPosition: fit.objectPosition } : undefined} onError={() => { setFailed(true); setActionError('图片文件加载失败。'); }} onLoad={(event) => {
        if (agentVariant === "single") setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
      }} /> : <span aria-label={failed || failedGeneration ? `${label}失败` : cancelled ? `${label}已取消` : `${label}加载中`} />}
      {generated ? <figcaption className="generated-image-caption">
        <span role="status" className={`generated-image-status${generating ? ' running' : ''}`}>
          {generating ? <CircleNotch size={14} aria-hidden="true" /> : null}
          {generating ? '正在生成' : failedGeneration ? '生成失败' : cancelled ? '已取消' : '生成图片'}
        </span>
        {canAct ? <div className="generated-image-actions">
          {generating ? <button type="button" aria-label="取消图片生成" title="取消图片生成" disabled={action === 'cancel'} onClick={() => runAction('cancel')}><Stop size={14} /></button>
            : <button type="button" aria-label="重新生成图片" title="重新生成图片" disabled={Boolean(action)} onClick={() => runAction('regenerate')}><ArrowClockwise size={14} /></button>}
        </div> : null}
        {image.errorMessage || actionError ? <span role="alert" className="generated-image-error">{actionError || image.errorMessage}</span> : null}
      </figcaption> : null}
      {compact && onRemove ? (
        <button type="button" onClick={() => onRemove(image.localId)} aria-label={`移除${label}`} title="移除图片">
          <X size={12} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {previewOpen && source ? <ChatImagePreview src={source} label={label} onClose={() => setPreviewOpen(false)} /> : null}
    </figure>
  );
}
