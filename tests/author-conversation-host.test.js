import { describe, expect, it, vi } from 'vitest';
import { AUTHOR_API_VERSION } from '@eleckoi/author-sdk';
import { routeAuthorConversationRequest } from '../apps/web/src/modules/authorFrontend/model/authorConversationHost.js';

function request(method, params = {}) {
  return JSON.stringify({ id: `${method}-request`, apiVersion: AUTHOR_API_VERSION, method, params });
}

function harness() {
  const user = {
    id: 'user-1', conversationId: 'chat-1', role: 'user', content: '问题', displayContent: '问题',
    variableStateJson: '{"hp":7}', status: 'complete', createdAt: 'now', sessionEventSeq: 3,
  };
  const assistant = {
    id: 'assistant-1', conversationId: 'chat-1', role: 'assistant', content: '回答', displayContent: '<b>回答</b>',
    variableStateJson: '{"hp":8,"label":"{{user}}/{{char}}"}', status: 'complete', createdAt: 'later', sessionEventSeq: 8,
    process: [{ id: 'tool-1', kind: 'tool', status: 'complete', toolName: 'read_file', summary: '完成' }],
    inputImageAttachments: [{ attachmentId: 'image-1', mediaType: 'image/png', bytes: 12, width: 2, height: 3 }],
  };
  let details = {
    conversation: { id: 'chat-1', title: 'Chat', preview: '', createdAt: 'now', updatedAt: 'now' },
    metadata: { characterId: 'card-1', characterName: 'Card', characterAvatar: '', characterPersona: { user_name: 'Reader' } },
    runtimeSessionId: 'session-1', messages: [user, assistant], hasMore: false, beforeSequence: null,
  };
  let state = { hp: 9 };
  const send = vi.fn(async () => ({ details }));
  const regenerate = vi.fn(async () => ({ details }));
  const deleteMessagesFrom = vi.fn(async () => ({ deletedMessageCount: 1, remainingMessageCount: 1, details }));
  const replaceAuthorVariableState = vi.fn(async (_conversationId, next) => { state = next; return next; });
  const items = [{ ...details.conversation, metadata: details.metadata, runtimeSessionId: details.runtimeSessionId }];
  const conversations = {
    getDetailsSnapshot: () => ({ id: 'chat-1', status: 'ready', details }),
    getSnapshot: () => ({ status: 'ready', items, error: '' }),
    getStreamSnapshot: () => ({ id: 'chat-1', status: 'idle', runId: 'session-1', messageId: '', sequence: 0, content: '', process: [], error: '' }),
    getStatsSnapshot: () => ({ id: 'chat-1', stats: null }),
    open: vi.fn(async () => details),
    refreshDetails: vi.fn(async () => details),
    refresh: async () => items,
    readAuthorState: async () => ({
      initialVariableStateJson: '{"hp":1}', currentVariableStateJson: JSON.stringify(state),
      variableConfig: { characterId: 'card-1', variables: [], objects: [], versions: [] },
      settingLibrarySummary: { characterId: 'card-1', name: 'World', activeVersionId: 'v1', entryCount: 1, groupCount: 0 },
      settingLibrary: { characterId: 'card-1', name: 'World', entries: [{ id: 'entry-1', content: 'facts' }], groups: [], promptPositions: [] },
    }),
    readTrajectory: async () => ({
      systemPrompts: [],
      eventNodes: [
        { kind: 'user', seq: 3, time: 100, content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } },
        { kind: 'assistant', seq: 8, time: 180, turn: 1, step: 1,
          blocks: [{ kind: 'text', text: '回答' }], provenance: { provider: 'provider-1', model: 'model-1' } },
      ],
      eventLocations: new Map(),
      requests: [{
        purpose: 'assistant', startSeq: 4, startedAt: 110, completedAt: 180,
        status: 'complete', turn: 1, step: 1,
        resultSeq: 8,
        requestConfig: { provider: 'provider-1', model: 'model-1' },
      }],
      callSchemas: new Map(),
      partial: null,
      runningCalls: [],
    }),
    replaceAuthorVariableState,
    selectOpening: vi.fn(async () => details),
    deleteMessagesFrom,
    regenerate,
    readModelSelection: async () => ({ provider: 'provider-1', model: 'model-1' }),
    selectModel: vi.fn(async (_id, selection) => selection),
    send,
    cancelStream: vi.fn(async () => true),
    create: vi.fn(async () => details),
    delete: vi.fn(async () => undefined),
    readImage: vi.fn(async () => 'blob:dsh-session-image'),
  };
  const models = { getSnapshot: () => ({ status: 'ready', configs: [{
    id: 'provider-1', name: 'Provider', provider: 'provider-1', model: 'model-1',
    model_options: [{ id: 'model-1', name: 'Model', inputModalities: ['text', 'image'], supportsImageInput: true }],
  }] }) };
  const context = { bridgeKey: crypto.randomUUID(), conversationId: 'chat-1', messageId: 'assistant-1', conversations, models };
  const invoke = async (method, params) => JSON.parse(await routeAuthorConversationRequest(request(method, params), context));
  return { invoke, conversations, context, send, regenerate, deleteMessagesFrom, replaceAuthorVariableState };
}

describe('DSH Client author conversation bridge', () => {
  it('reads projected messages and writes variables through the conversation Remote model', async () => {
    const { invoke, replaceAuthorVariableState } = harness();
    expect(await invoke('messages.current')).toMatchObject({ ok: true, result: {
      id: 'assistant-1', displayContent: '<b>回答</b>', variableState: { hp: 8 },
      process: [{ toolName: 'read_file' }], attachments: [{ id: 'image-1', url: 'blob:dsh-session-image' }],
    } });
    expect((await invoke('messages.current')).result.variableState.label).toBe('Reader/Card');
    expect(await invoke('variables.applyPatch', { patch: [{ op: 'replace', path: '/hp', value: 10 }] }))
      .toMatchObject({ ok: true, result: { hp: 10 } });
    expect(replaceAuthorVariableState).toHaveBeenCalledWith('chat-1', { hp: 10 });
  });

  it('does not reopen a deleted conversation for a late author frontend request', async () => {
    const { invoke, conversations } = harness();
    conversations.getDetailsSnapshot = () => ({ id: '', status: 'idle', details: null });
    const result = await invoke('variables.getState');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTEXT', message: '当前消息所属聊天已关闭' },
    });
    expect(conversations.open).not.toHaveBeenCalled();
    expect(conversations.refreshDetails).not.toHaveBeenCalled();
  });

  it('allows global message listing after the iframe anchor message was rewound', async () => {
    const { invoke, context } = harness();
    context.messageId = 'rewound-message';
    expect(await invoke('messages.list')).toMatchObject({ ok: true, result: [
      { id: 'user-1', role: 'user', content: '问题' },
      { id: 'assistant-1', role: 'assistant', content: '回答' },
    ] });
  });

  it('uses the official conversation client for send, regeneration and deletion', async () => {
    const { invoke, send, regenerate, deleteMessagesFrom } = harness();
    expect(await invoke('chat.send', { text: '继续' })).toMatchObject({ ok: true, result: { accepted: true, runId: 'session-1' } });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat-1', text: '继续', requestId: expect.any(String) }));
    expect(await invoke('messages.regenerate', { id: 'assistant-1' })).toMatchObject({ ok: true, result: { accepted: true } });
    expect(regenerate).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat-1', eventSeq: 3, requestId: expect.any(String) }));
    expect(await invoke('messages.deleteFrom', { id: 'assistant-1' })).toMatchObject({ ok: true, result: { deletedMessageCount: 1 } });
    expect(deleteMessagesFrom).toHaveBeenCalledWith('chat-1', 8, 'assistant');
  });

  it('exposes the DSH model catalog without provider secrets', async () => {
    const { invoke } = harness();
    const result = await invoke('chat.getModels');
    expect(result).toMatchObject({ ok: true, result: {
      current: { configId: 'provider-1', model: 'model-1' },
      items: [{ configId: 'provider-1', models: [{ id: 'model-1', supportsImageInput: true }] }],
    } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('projects the official DSH trajectory target into the author SDK contract', async () => {
    const { invoke } = harness();
    const result = await invoke('chat.getAgentTrajectory', { limit: 20 });
    expect(result).toMatchObject({ ok: true, result: {
      conversationId: 'chat-1', runtimeThreadId: 'session-1', totalRecords: 2, hasMore: false,
      records: [
        { index: 1, seq: 3, kind: 'user', status: 'complete', requests: [] },
        { index: 2, seq: 8, kind: 'assistant', status: 'complete', requests: [{
          number: 1, seq: 4, turn: 1, step: 1, provider: 'provider-1', model: 'model-1',
        }] },
      ],
    } });
  });
});
