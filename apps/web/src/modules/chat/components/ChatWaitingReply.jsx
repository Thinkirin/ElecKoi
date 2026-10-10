import { useEffect, useState } from "react";
import { RunningWhaleTail } from "./RunningWhaleTail.jsx";

export function ChatWaitingReply({ startTime }) {
  const [startedAt, setStartedAt] = useState(() => startTime ?? Date.now());
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const next = startTime ?? Date.now();
    setStartedAt(next);
    setNow(next);
  }, [startTime]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const duration = formatLiveRunDuration(Math.max(1000, now - startedAt));
  return (
    <div className="chat-waiting-reply" data-chat-running>
      <span className="chat-waiting-announcement" role="status" aria-live="polite" aria-atomic="true">深度求索中</span>
      <span className="chat-waiting-content" aria-hidden="true">
        <RunningWhaleTail />
        <RunningTextShimmer>深度求索中，用时 {duration}...</RunningTextShimmer>
      </span>
    </div>
  );
}

function RunningTextShimmer({ children }) {
  return <span className="chat-waiting-shimmer">
    <span className="chat-waiting-shimmer-text">{children}</span>
    <span className="chat-waiting-shimmer-decoration" aria-hidden="true">
      <span className="chat-waiting-shimmer-sweep">
        <span className="chat-waiting-shimmer-highlight">{children}</span>
      </span>
    </span>
  </span>;
}

export function formatLiveRunDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = String(totalSeconds % 60);
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, "0")}分${seconds}秒`;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}
