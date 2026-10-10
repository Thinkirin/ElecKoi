import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TextAlignLeft, X } from "@phosphor-icons/react";
import { RequestContextPanel, zh } from "@eleckoi/dsh-client-trajectory/client/request-context";

const translate = (key, values = {}) => zh[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? name));

export function RequestPreviewDialog({ conversationId, conversationModel, onClose }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [catalog, setCatalog] = useState({ requests: [], loading: true, error: "" });
  const [selectedId, setSelectedId] = useState("");
  const latestId = useRef("");
  const [context, setContext] = useState({ id: "", items: null, error: "" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ requests: [], loading: true, error: "" });
    setSelectedId("");
    latestId.current = "";
    if (!conversationModel) {
      setCatalog({ requests: [], loading: false, error: "DSH 聊天服务尚未就绪。" });
      return () => controller.abort();
    }
    void conversationModel.observeRequestPreviews(conversationId, requests => {
      if (controller.signal.aborted) return;
      const previousLatest = latestId.current;
      const nextLatest = requests.at(-1)?.id || "";
      latestId.current = nextLatest;
      setCatalog({ requests, loading: false, error: "" });
      setSelectedId(current => !current || current === previousLatest || !requests.some(request => request.id === current)
        ? nextLatest : current);
    }, controller.signal).catch(error => {
      if (!controller.signal.aborted) setCatalog(current => ({ ...current, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, [conversationId, conversationModel]);

  useEffect(() => {
    const controller = new AbortController();
    setContext({ id: selectedId, items: null, error: "" });
    if (selectedId && conversationModel) void conversationModel.readRequestPreview(conversationId, selectedId, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setContext({ id: selectedId, items: value.items, error: "" });
      }, error => {
        if (!controller.signal.aborted) setContext({ id: selectedId, items: null, error: error.message });
      });
    return () => controller.abort();
  }, [conversationId, conversationModel, selectedId, retry]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const keys = event => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const groups = useMemo(() => {
    const result = new Map();
    for (const request of catalog.requests) {
      const key = request.round === null ? `turn:${request.turn}` : `round:${request.round}`;
      if (!result.has(key)) result.set(key, { label: request.round === null ? `执行轮次 ${request.turn}` : `第 ${request.round} 轮`, requests: [] });
      result.get(key).requests.push(request);
    }
    return [...result.values()].reverse();
  }, [catalog.requests]);

  return createPortal(<div className="request-preview-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} className="request-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onMouseDown={event => event.stopPropagation()}>
      <header className="request-preview-header">
        <TextAlignLeft size={20} aria-hidden="true" />
        <h2 id={titleId}>请求上下文预览</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭请求上下文预览"><X size={18} /></button>
      </header>
      <div className="request-preview-body">
        <aside className="request-preview-catalog" aria-label="轮次与请求">
          {catalog.loading ? <p className="request-preview-empty" role="status">正在读取请求列表</p> : null}
          {catalog.error ? <p className="request-preview-empty is-error" role="alert">{catalog.error}</p> : null}
          {!catalog.loading && !catalog.error && groups.length === 0
            ? <p className="request-preview-empty">暂无请求</p> : null}
          {groups.map(group => <section className="request-preview-round" key={group.label}>
            <h3>{group.label}</h3>
            {group.requests.map(request => <button key={request.id} type="button"
              className={request.id === selectedId ? "active" : ""} aria-current={request.id === selectedId ? "true" : undefined}
              onClick={() => setSelectedId(request.id)}>
              <strong>请求 {request.request}</strong><small title={request.model}>{request.model}</small>
            </button>)}
          </section>)}
        </aside>
        <main className="request-preview-content" key={selectedId} aria-label="请求上下文">
          {!selectedId ? <p className="request-preview-empty">{catalog.loading ? "" : "本次运行尚未发起请求"}</p>
            : context.id !== selectedId || (!context.items && !context.error)
              ? <p className="request-preview-empty" role="status">正在读取请求上下文</p>
              : context.error ? <div className="request-preview-empty is-error" role="alert">
                <p>{context.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
              </div> : <RequestContextPanel items={context.items} t={translate} />}
        </main>
      </div>
    </section>
  </div>, document.body);
}
