import { WarningCircle } from '@phosphor-icons/react';

/** Display the durable DSH failure where its turn ended, outside reply content. */
export function ChatTurnError({ message, layoutMode }) {
  return <article className={`chat-turn-error layout-${layoutMode}`} role="alert"
    data-message-id={message.id} data-dsh-node-kind="turn-error" data-dsh-node-key={message.dshNodeKey}
    data-dsh-turn={message.dshTurn}>
    <WarningCircle size={20} aria-hidden="true" />
    <div className="chat-turn-error-copy">
      <strong>回复失败</strong>
      <p>{message.error?.message || message.content}</p>
      {message.error?.code ? <code>{message.error.code}</code> : null}
    </div>
  </article>;
}
