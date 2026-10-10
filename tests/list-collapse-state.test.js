import { describe, expect, it } from 'vitest';
import {
  LIST_COLLAPSE_AREAS,
  normalizeCollapsedGroups,
} from '../apps/web/src/modules/settings/model/listCollapseState.js';

describe('persistent list collapse state', () => {
  it('keeps the four list preferences independent', () => {
    expect(new Set(Object.values(LIST_COLLAPSE_AREAS)).size).toBe(4);
    expect(LIST_COLLAPSE_AREAS.plugins).toBe('plugins');
  });

  it('keeps boolean states and prunes groups that no longer exist', () => {
    expect(normalizeCollapsedGroups(
      { '全部预设': true, 已删除: true, invalid: 'no' },
      {},
      ['全部预设'],
    )).toEqual({ '全部预设': true });
  });
});
