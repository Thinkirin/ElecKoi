// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useActiveChatModel } from '../apps/web/src/modules/chat/hooks/useActiveChatModel.js';

describe('chat model selection authority', () => {
  it('keeps one global model selection while chats change', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    const conversations = { readModelSelection: vi.fn(async () => ({ provider: 'removed', model: 'old-model' })),
      selectModel: vi.fn(async (_id, selection) => selection) };
    let current;
    const setStatus = vi.fn();
    const configs = [{ id: 'config-current', model: 'example-model', credentialConfigured: true }];
    function Probe({ id }) {
      current = useActiveChatModel({ conversations, conversationId: id, modelConfigs: configs, setStatus });
      return null;
    }
    try {
      await act(async () => root.render(<Probe id="same-chat" />));
      expect(conversations.selectModel).toHaveBeenCalledExactlyOnceWith('', { provider: 'config-current', model: 'example-model' });
      expect(current.modelConfig).toMatchObject({ id: 'config-current', model: 'example-model' });
      await act(async () => root.render(<Probe id="" />));
      await act(async () => current.selectChatModel({ configId: 'config-current', model: 'another-model' }));
      expect(current.modelConfig.model).toBe('another-model');
      expect(conversations.selectModel).toHaveBeenCalledTimes(2);
      expect(conversations.selectModel).toHaveBeenLastCalledWith('', { provider: 'config-current', model: 'another-model' });
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
