import { describe, expect, it } from 'vitest';
import { liveProcessPresentation, processItemPresentation, shouldShowInlineAgentProcess } from '../apps/web/src/modules/chat/model/agentProcessPresentation.js';

const pendingAssistant = {
  role: 'assistant',
  pending: true,
  process: [{ id: 'read-variables', status: 'running' }],
};

describe('inline agent process presentation', () => {
  it('does not present rejected or unchanged setting tools as successful mutations', () => {
    const tool = { toolName: 'eleckoi_apply_setting_patch', kind: 'file_change', status: 'complete',
      arguments: JSON.stringify({ path: '合成设定' }) };
    expect(processItemPresentation({ ...tool, summary: JSON.stringify({ status: 'change_rejected' }) }).title)
      .toBe('修改对话设定失败');
    expect(processItemPresentation({ ...tool, summary: JSON.stringify({ status: 'ok', changed: false }) }).title)
      .toBe('设定未变化');
    expect(processItemPresentation({ ...tool, summary: JSON.stringify({ status: 'ok', changed: true }) }).title)
      .toBe('已修改对话设定');
  });
  it('uses the dedicated reasoning mascot instead of a generic document glyph', () => {
    expect(processItemPresentation({ kind: 'reasoning', toolName: 'reasoning', status: 'running' })).toMatchObject({
      title: '正在思考',
      icon: 'reasoning',
    });
  });

  it('shows the delegated task and effective child model on one subagent row', () => {
    expect(processItemPresentation({
      kind: 'subagent',
      toolName: 'subagent',
      status: 'complete',
      arguments: JSON.stringify({ description: '搜索最新资讯' }),
      delegatedModel: 'deepseek-chat',
    })).toMatchObject({
      title: '子 Agent 已完成',
      target: '搜索最新资讯 · deepseek-chat',
      icon: 'groups',
    });
  });

  it('keeps delegated child activity behind the parent item in the live summary', () => {
    expect(liveProcessPresentation([
      { id: 'delegate', kind: 'subagent', toolName: 'subagent', status: 'running', arguments: '{"description":"搜索资讯"}' },
      { id: 'child-search', parentId: 'delegate', kind: 'tool', toolName: 'web_search', status: 'running' },
    ])).toMatchObject({ title: '子 Agent 正在处理', target: '搜索资讯' });
  });

  it('owns the message body slot before reply content arrives', () => {
    expect(shouldShowInlineAgentProcess(pendingAssistant, '')).toBe(true);
  });

  it('hands the slot to the reply as soon as content arrives', () => {
    expect(shouldShowInlineAgentProcess(pendingAssistant, '第一段正文')).toBe(false);
  });

  it('does not return after the turn completes', () => {
    expect(shouldShowInlineAgentProcess({ ...pendingAssistant, pending: false }, '')).toBe(false);
  });
});
