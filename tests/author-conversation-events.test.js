import { describe, expect, it, vi } from 'vitest';
import {
  authorConversationEventNames,
  publicAuthorEvent,
  subscribeAuthorConversationEvents,
} from '../apps/web/src/modules/authorFrontend/model/authorConversationEvents.js';

function conversationModel() {
  let details = { id: 'chat-1', status: 'ready', runtimeSessionId: 'session-1', details: { messages: [] } };
  let stream = { id: 'chat-1', status: 'idle', runId: '', messageId: '', sequence: 0, content: '', process: [], error: '' };
  let stats = { id: 'chat-1', stats: {} };
  const listeners = { details: new Set(), stream: new Set(), stats: new Set() };
  return {
    getDetailsSnapshot: () => details,
    getStreamSnapshot: () => stream,
    getStatsSnapshot: () => stats,
    subscribeDetails(listener) { listeners.details.add(listener); return () => listeners.details.delete(listener); },
    subscribeStream(listener) { listeners.stream.add(listener); return () => listeners.stream.delete(listener); },
    subscribeStats(listener) { listeners.stats.add(listener); return () => listeners.stats.delete(listener); },
    readImage: async () => 'blob:dsh-session-image',
    publishDetails(next) { details = next; for (const listener of listeners.details) listener(); },
    publishStream(next) { stream = next; for (const listener of listeners.stream) listener(); },
    publishStats(next) { stats = next; for (const listener of listeners.stats) listener(); },
  };
}

describe('author conversation events', () => {
  it('publishes the complete native Agent process event set', () => {
    expect(authorConversationEventNames).toEqual([
      'messages.changed',
      'agent.output.delta',
      'agent.run.finished',
      'agent.run.failed',
      'agent.state.changed',
      'agent.process.updated',
      'agent.generation.stats',
    ]);
  });

  it('projects a finished message without dropping process or media data', async () => {
    const payload = await publicAuthorEvent('agent.run.finished', {
      conversationId: 'chat-1',
      runId: 'run-1',
      message: {
        id: 'assistant-1',
        conversationId: 'chat-1',
        role: 'assistant',
        content: 'done',
        variableStateJson: '{"hp":8}',
        status: 'complete',
        createdAt: 'now',
        process: [{ id: 'tool-1', kind: 'tool', status: 'complete', toolName: 'read_file' }],
        inputImageAttachments: [{ attachmentId: 'image-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
      },
    }, async () => 'blob:dsh-session-image');

    expect(payload.message).toMatchObject({
      variableState: { hp: 8 },
      process: [{ id: 'tool-1', kind: 'tool', toolName: 'read_file' }],
      attachments: [{ id: 'image-1', type: 'image', url: 'blob:dsh-session-image' }],
    });
  });

  it('derives author events from the official DSH conversation projections', async () => {
    const model = conversationModel();
    const events = [];
    const dispose = subscribeAuthorConversationEvents(model, 'chat-1', (event) => events.push(event));

    model.publishStream({
      id: 'chat-1', status: 'running', runId: 'session-1', messageId: 'assistant-1', sequence: 1,
      content: '', process: [{ id: 'tool-1', kind: 'tool', status: 'running', toolName: 'read_file' }], error: '',
    });
    model.publishStream({
      id: 'chat-1', status: 'running', runId: 'session-1', messageId: 'assistant-1', sequence: 2,
      content: '完成', process: [{ id: 'tool-1', kind: 'tool', status: 'complete', toolName: 'read_file' }], error: '',
    });
    model.publishDetails({
      id: 'chat-1', status: 'ready', runtimeSessionId: 'session-1', details: { messages: [{
        id: 'assistant-1', conversationId: 'chat-1', role: 'assistant', content: '完成', status: 'complete',
        createdAt: 'now', process: [],
      }] },
    });
    model.publishStats({
      id: 'chat-1',
      stats: {
        sessionStats: { turns: 1, steps: 2, llmMs: 10, toolMs: 5 },
        tokenUsage: { uncachedInputTokens: 20, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 0 },
        contextPressure: { pressureTokens: 24 },
        contextBreakdown: { systemTokens: 2, toolsTokens: 3, messageTokens: 19 },
      },
    });
    model.publishStream({
      id: 'chat-1', status: 'idle', runId: 'session-1', messageId: 'assistant-1', sequence: 2,
      content: '完成', process: [], error: '',
    });

    await vi.waitFor(() => expect(events.map((event) => event.name)).toEqual(expect.arrayContaining([
      'agent.state.changed',
      'agent.process.updated',
      'agent.output.delta',
      'messages.changed',
      'agent.generation.stats',
      'agent.run.finished',
    ])));
    expect(events.find((event) => event.name === 'agent.output.delta')?.payload.delta).toBe('完成');
    expect(events.find((event) => event.name === 'agent.generation.stats')?.payload.stats).toMatchObject({
      turns: 1,
      steps: 2,
      tokenUsage: { uncachedInputTokens: 20, outputTokens: 3 },
      contextPressure: { pressureTokens: 24 },
    });
    expect(events.find((event) => event.name === 'agent.run.finished')?.payload.message.content).toBe('完成');
    dispose();
  });
});
