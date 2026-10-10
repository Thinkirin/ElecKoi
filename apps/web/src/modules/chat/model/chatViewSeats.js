// Read-only render adapters: DSH owns input admission and echo retirement.
// This module does not retain transcript or pending-message state.
function inputAttachments(content = []) {
  return {
    inputImageAttachments: content.filter(block => block.type === 'image').map(block => block.attachment),
    inputFileAttachments: content.filter(block => block.type === 'file').map(block => block.attachment),
  };
}

export function selectRoleplayChatSeat(messages, runtimeSessionId, node) {
  if (node.kind === 'turn-process') {
    const turn = node.location?.turn?.turn;
    if (!Number.isSafeInteger(turn)) return null;
    const key = `dsh-reply-${runtimeSessionId}-${turn}`;
    const index = messages.findIndex(message => message.runtimeSessionId === runtimeSessionId && message.renderKey === key);
    return index < 0 ? null : { item: messages[index], index };
  }
  if (node.kind !== 'user' && node.kind !== 'steering') {
    return ['turn-error', 'turn-max-tokens', 'model-retry'].includes(node.kind) ? undefined : null;
  }
  const input = node.data;
  const requestId = input.source?.kind === 'user' ? input.source.rpcId : undefined;
  const index = messages.findIndex(message => message.runtimeSessionId === runtimeSessionId && (
    message.sessionEventSeq === input.seq || (requestId && message.requestId === requestId)
  ));
  if (index >= 0 && !messages[index].pending) return { item: { ...messages[index], renderKey: node.key }, index };
  // A formal Node can arrive before product metadata. Metadata must not gate
  // an admitted input's visibility; the official Seat retains its identity.
  return {
    index: index < 0 ? messages.length : index,
    item: {
      ...(index < 0 ? {} : messages[index]),
      id: input.messageId || node.key,
      renderKey: node.key,
      runtimeSessionId, requestId, dshMessageId: input.messageId || '',
      dshNodeKey: node.key, sessionEventSeq: input.seq, sequence: input.seq,
      role: 'user', pending: false, status: 'complete',
      content: input.content.filter(block => block.type === 'text').map(block => block.text).join(''),
      created_at: new Date(input.time).toISOString(), ...inputAttachments(input.content),
    },
  };
}

export function selectRoleplayPendingInput(messages, runtimeSessionId, input) {
  const requestId = 'requestId' in input ? input.requestId : input.source?.rpcId;
  const index = requestId ? messages.findIndex(message => message.runtimeSessionId === runtimeSessionId
    && message.requestId === requestId) : -1;
  if (index >= 0) return { item: { ...messages[index], pending: true }, index };
  const submission = 'requestId' in input;
  return {
    index: messages.length,
    item: {
      id: `dsh-pending-${requestId || input.id}`, runtimeSessionId, requestId,
      role: 'user', pending: true, status: 'streaming',
      content: submission ? input.text : input.content.filter(block => block.type === 'text').map(block => block.text).join(''),
      created_at: submission ? new Date(input.time).toISOString() : undefined,
      ...(submission ? {
        inputImageAttachments: input.attachments.flatMap((item, attachmentIndex) => item.type === 'image'
          ? [{ ...item.value, attachmentId: `pending-${requestId}-${attachmentIndex}` }] : []),
        inputFileAttachments: input.attachments.filter(item => item.type === 'file').map(item => item.value),
      } : inputAttachments(input.content)),
    },
  };
}
