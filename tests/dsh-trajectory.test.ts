import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { createSessionFormatCatalogWithChildren, sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { projectDshTrajectory, readDshSessionLog, readDshTrajectory, removeDshSessionTree } from '@eleckoi/dsh-runtime'
import { agentTrajectorySnapshotSchema } from '../packages/product-shared/src/contracts/agent/trajectory'

// Session codecs validate cwd with the host platform's path semantics.
const fixtureWorkspace = join(tmpdir(), 'eleckoi-trajectory-workspace')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    const child = relative(tmpdir(), directory)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected test cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('DSH trajectory projection', () => {
  it('reads a legacy V3 log with its missing system head repaired by the adjacent migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-trajectory-v3-read-'))
    temporaryDirectories.push(root)
    const sessionId = 'historical-session'
    const directory = join(root, 'project-a', sessionId)
    mkdirSync(directory, { recursive: true })
    const header = releasedV3SessionFormatCodec.encodeHeader({
      version: 3, id: sessionId, createdAt: 1_000, cwd: fixtureWorkspace,
      isSeeded: false, delegationDepth: 0
    }, 0)
    const events = [
      event(0, 'turn/start', { turn: 1 }, 1_001),
      event(1, 'user/message', {
        role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }]
      }, 1_002, 'append'),
      event(2, 'step/start', { turn: 1, step: 1 }, 1_003),
      event(3, 'assistant/message', { turn: 1, step: 1, message: {
        id: 'seeded-reply', role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '已有回答' }]
      } }, 1_004, 'append'),
      event(4, 'step/end', { turn: 1, step: 1 }, 1_005),
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 1_006),
      event(6, 'session/end-seed', {}, 1_007),
      event(7, 'turn/start', { turn: 2 }, 1_008),
      event(8, 'step/start', { turn: 2, step: 1 }, 1_009),
      event(9, 'system/message', { turn: 2, step: 1, message: {
        id: 'system', role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
        content: [{ type: 'text', text: '系统说明' }]
      } }, 1_010, 'append'),
      event(10, 'assistant/message', { turn: 2, step: 1, message: {
        id: 'reply', role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '回答' }]
      } }, 1_011, 'append'),
      event(11, 'step/end', { turn: 2, step: 1 }, 1_012),
      event(12, 'turn/end', { turn: 2, reason: { kind: 'completed' } }, 1_013)
    ]
    const path = join(directory, 'session.v3.jsonl')
    const source = `${[header, ...events.map((item) => releasedV3SessionFormatCodec.encodeEvent(item))]
      .map((row) => JSON.stringify(row)).join('\n')}\n`
    writeFileSync(path, source)

    const migrated = createSessionFormatCatalogWithChildren([]).createRestore(header, {
      recovery: 'strict', validation: 'transformed'
    })
    for (const item of events) migrated.decodeRow(releasedV3SessionFormatCodec.encodeEvent(item))
    const result = migrated.finish()
    expect(result.events.filter(item => item.type === 'system/message')).toHaveLength(2)
    expect(readDshSessionLog(root, sessionId)?.events).toEqual(result.events)
    expect(readDshSessionLog(root, sessionId)?.header.version).toBe(4)
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  it('reads a historical V3 parent with direct child evidence without changing either log', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-trajectory-v3-'))
    temporaryDirectories.push(root)
    const parentDirectory = join(root, 'project-a', 'parent')
    const childDirectory = join(root, 'project-a', 'child')
    mkdirSync(parentDirectory, { recursive: true })
    mkdirSync(childDirectory, { recursive: true })
    const base = { version: 3, createdAt: 1_000, cwd: fixtureWorkspace, isSeeded: false, delegationDepth: 0 }
    const parent = releasedV3SessionFormatCodec.encodeHeader({ ...base, id: 'parent' }, 0)
    const child = releasedV3SessionFormatCodec.encodeHeader({
      ...base, id: 'child', createdAt: 1_010, parentSession: 'parent', origin: 'subagent', delegationDepth: 1
    }, 0)
    writeFileSync(join(parentDirectory, 'session.v3.jsonl'), `${JSON.stringify(parent)}\n`)
    writeFileSync(join(childDirectory, 'session.v3.jsonl'), `${JSON.stringify(child)}\n`)
    expect(readDshTrajectory(root, 'parent')).toMatchObject({ runtimeThreadId: 'parent', totalRecords: 0 })
  })

  it('removes one stored Session tree without touching unrelated sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-session-remove-'))
    temporaryDirectories.push(root)
    const project = join(root, 'project-a')
    const headers = [
      { id: 'parent', delegationDepth: 0 },
      { id: 'child', parentSession: 'parent', origin: 'subagent' as const, delegationDepth: 1 },
      { id: 'grandchild', parentSession: 'child', origin: 'subagent' as const, delegationDepth: 2 },
      { id: 'unrelated', delegationDepth: 0 }
    ]
    for (const header of headers) {
      const directory = join(project, header.id)
      mkdirSync(directory, { recursive: true })
      const row = releasedV3SessionFormatCodec.encodeHeader({
        version: 3,
        createdAt: 1_000,
        cwd: fixtureWorkspace,
        isSeeded: false,
        ...header
      }, 0)
      writeFileSync(join(directory, 'session.v3.jsonl'), `${JSON.stringify(row)}\n`)
    }

    expect(readDshSessionLog(root, 'parent')?.header.id).toBe('parent')
    removeDshSessionTree(root, 'parent')

    expect(existsSync(join(project, 'parent'))).toBe(false)
    expect(existsSync(join(project, 'child'))).toBe(false)
    expect(existsSync(join(project, 'grandchild'))).toBe(false)
    expect(existsSync(join(project, 'unrelated'))).toBe(true)
    expect(readDshSessionLog(root, 'parent')).toBeUndefined()
  })

  it('keeps the raw event ledger separate while pairing calls with their results', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'step/start', { turn: 1, step: 1 }, 1_010),
      event(2, 'user/message', {
        content: [{ type: 'text', text: '你好' }],
        source: { kind: 'user' },
        role: 'user'
      }, 1_020, 'append'),
      event(3, 'user/message', {
        content: [{ type: 'text', text: '工作区说明' }],
        source: { kind: 'agent-instructions' },
        role: 'user'
      }, 1_030, 'append'),
      event(4, 'user/message', {
        content: [{
          type: 'text',
          text: 'ELECKOI_REQUEST_PROJECTION_V2\n{"plan":[{"content":"内部定义"}],"history":[{"role":"user","content":"被回退后保留的问题"}]}'
        }],
        source: { kind: 'plugin:eleckoi-request-projection' },
        role: 'user'
      }, 1_035, 'append'),
      event(5, 'request/header', {
        header: { system: '系统提示词', config: { provider: 'deepseek-official', model: 'deepseek-chat' } },
        reason: 'initial'
      }, 1_040),
      event(6, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '我来查看' }] },
        usage: { inputTokens: 120, outputTokens: 8 }
      }, 1_200),
      event(7, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-a',
        name: 'read',
        arguments: '{"path":"README.md"}'
      }, 1_220),
      event(8, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          source: { kind: 'tool', callId: 'call-a' },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-a',
            content: [{ type: 'text', text: '文件内容' }],
            isError: false
          }]
        }
      }, 1_270)
    ], { createdAt: 990 })

    expect(result.records.map((record) => record.kind)).toEqual([
      'user', 'context', 'assistant', 'tool'
    ])
    expect(result.records.map((record) => record.index)).toEqual([1, 2, 3, 4])
    expect(result.records[1]).toMatchObject({ title: 'Agent 指令', source: 'agent-instructions' })
    expect(result.records[2]).toMatchObject({
      durationMillis: 190,
      output: '我来查看',
      requests: [{ number: 1, seq: 1, provider: 'deepseek-official', model: 'deepseek-chat' }]
    })
    expect(result.records[2]?.requests[0]).not.toHaveProperty('context')
    expect(result.records[3]).toMatchObject({
      title: 'read',
      input: '{\n  "path": "README.md"\n}',
      output: '文件内容',
      durationMillis: 50,
      status: 'complete'
    })
    expect(JSON.parse(result.records[3]?.rawJson ?? '[]')).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('系统提示词')
    expect(JSON.stringify(result)).not.toContain('ELECKOI_REQUEST_PROJECTION_V2')
    expect(JSON.stringify(result)).not.toContain('内部定义')
    expect(result).toMatchObject({ startedAtMillis: 990, completedAtMillis: 1_270 })
  })

  it('projects the official request options, usage and assistant timing fields', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'step/start', { turn: 1, step: 1 }, 1_010),
      event(2, 'request/header', {
        header: {
          system: '不应进入轨迹',
          config: {
            provider: 'provider-a',
            model: 'model-a',
            reasoningEffort: 'high',
            maxTokens: 8_192
          }
        },
        reason: 'initial'
      }, 1_020),
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: '回' }
      }, 1_060),
      event(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'reply-a',
          role: 'assistant',
          source: { provider: 'provider-a', model: 'model-a' },
          content: [{ type: 'text', text: '回答' }]
        },
        usage: {
          inputTokens: 120,
          cacheReadTokens: 30,
          cacheWriteTokens: 10,
          outputTokens: 20,
          reasoningTokens: 5
        }
      }, 1_110),
      event(5, 'step/start', { turn: 1, step: 2 }, 1_120),
      event(6, 'request/header', {
        header: { config: { provider: 'provider-a', model: 'model-a' } },
        reason: 'continue'
      }, 1_130),
      event(7, 'assistant/message', {
        turn: 1,
        step: 2,
        message: {
          id: 'reply-b',
          role: 'assistant',
          source: { provider: 'provider-a', model: 'model-a' },
          content: [{ type: 'text', text: '继续回答' }]
        },
        usage: { inputTokens: 10, outputTokens: 8 }
      }, 1_180)
    ])

    expect(result.records[0]?.requests[0]).toMatchObject({
      purpose: 'assistant',
      requestConfig: {
        provider: 'provider-a',
        model: 'model-a',
        reasoningEffort: 'high',
        maxTokens: 8_192
      },
      usage: { input: 120, cacheRead: 30, cacheWrite: 10, output: 20, reasoning: 5 },
      cumulativeUsage: { input: 120, cacheRead: 30, cacheWrite: 10, output: 20, reasoning: 5 },
      startedAt: 1_010,
      completedAt: 1_110,
      firstTokenTime: 1_060,
      durationMillis: 100,
      resultSeq: 4
    })
    expect(result.records[1]?.requests[0]?.cumulativeUsage).toEqual({
      input: 130,
      cacheRead: 30,
      cacheWrite: 10,
      output: 28,
      reasoning: 5
    })
    expect(JSON.stringify(result)).not.toContain('不应进入轨迹')
  })

  it('reads the durable JSONL log, ignores a partial live tail and pages backwards', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-trajectory-'))
    temporaryDirectories.push(root)
    const runtimeThreadId = 'thread-a'
    const directory = join(root, 'project-a', runtimeThreadId)
    mkdirSync(directory, { recursive: true })
    const rows = currentSessionRows(runtimeThreadId, 1_000, [
      event(0, 'turn/start', { turn: 1 }, 1_010),
      event(1, 'step/start', { turn: 1, step: 1 }, 1_020),
      event(2, 'request/header', {
        header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } },
        reason: 'initial'
      }, 1_030),
      event(3, 'user/message', { content: [{ type: 'text', text: '问题' }], source: { kind: 'user' } }, 1_040, 'append'),
      event(4, 'tool/call', { turn: 1, step: 1, callId: 'call-a', name: 'read', arguments: '{}' }, 1_050),
      event(5, 'tool/result', { turn: 1, step: 1, message: {
        id: 'tool-result-a', role: 'tool', toolCallId: 'call-a', source: { kind: 'tool', callId: 'call-a' },
        content: [{ type: 'text', text: '文件内容' }]
      } }, 1_060, 'append'),
      event(6, 'assistant/message', { turn: 1, step: 1, message: {
        id: 'assistant-a', role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-chat' },
        content: [{ type: 'text', text: '回答' }]
      } }, 1_070, 'append')
    ])
    writeFileSync(
      join(directory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`),
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n{"partial":`
    )
    const latest = readDshTrajectory(root, runtimeThreadId, { limit: 2 })
    expect(latest.records.map((record) => record.kind)).toEqual(['tool', 'assistant'])
    expect(latest).toMatchObject({ totalRecords: 3, hasMore: true, beforeIndex: 2 })
    expect(latest.records.flatMap((record) => record.requests)[0]).not.toHaveProperty('context')

    const older = readDshTrajectory(root, runtimeThreadId, { beforeIndex: latest.beforeIndex ?? undefined, limit: 2 })
    expect(older.records.map((record) => record.kind)).toEqual(['user'])
    expect(older).toMatchObject({ totalRecords: 3, hasMore: false, beforeIndex: 1 })

    const staleContextFile = join(root, 'eleckoi-request-context', `${runtimeThreadId}.jsonl`)
    mkdirSync(join(root, 'eleckoi-request-context'), { recursive: true })
    writeFileSync(staleContextFile, `${JSON.stringify({
      requestSeq: 1, turn: 1, step: 1, timeMillis: 999,
      items: [{ order: 1, messageId: 'stale', role: 'user', kind: 'user', title: '旧请求', source: '', anchor: '', content: '已回退的正文' }]
    })}\n`)
    expect(readDshTrajectory(root, runtimeThreadId).records.flatMap((record) => record.requests)[0]).not.toHaveProperty('context')
  })

  it('reuses one decoded current Session version and invalidates it after the log changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-session-log-cache-'))
    temporaryDirectories.push(root)
    const runtimeThreadId = 'cached-thread'
    const directory = join(root, 'project-a', runtimeThreadId)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `session.v${sessionFormatCatalog.currentVersion}.jsonl`)
    const firstEvents = [event(0, 'turn/start', { turn: 1 }, 1_010)]
    writeFileSync(path, `${currentSessionRows(runtimeThreadId, 1_000, firstEvents).map((row) => JSON.stringify(row)).join('\n')}\n`)

    const first = readDshSessionLog(root, runtimeThreadId)
    const reused = readDshSessionLog(root, runtimeThreadId)
    expect(reused).toBe(first)

    const nextEvents = [...firstEvents, event(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }, 1_020)]
    writeFileSync(path, `${currentSessionRows(runtimeThreadId, 1_000, nextEvents).map((row) => JSON.stringify(row)).join('\n')}\n`)
    const refreshed = readDshSessionLog(root, runtimeThreadId)
    expect(refreshed).not.toBe(first)
    expect(refreshed?.events).toHaveLength(2)
  })

  it('keeps DSH session-global request numbers across turns, resumes and compactions', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'step/start', { turn: 1, step: 1 }, 1_010),
      event(2, 'request/header', {
        header: { system: '系统提示词', tools: [], config: { model: 'deepseek-chat' } },
        reason: 'initial'
      }, 1_020),
      event(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '第一次' }] }
      }, 1_030),
      event(4, 'step/start', { turn: 1, step: 2 }, 1_040),
      event(5, 'request/header', {
        header: { system: '系统提示词', tools: [], config: { model: 'deepseek-chat' } },
        reason: 'continue'
      }, 1_050),
      event(6, 'assistant/message', {
        turn: 1,
        step: 2,
        message: { content: [{ type: 'text', text: '第二次' }] }
      }, 1_060),
      event(7, 'turn/end', { turn: 1 }, 1_070),
      event(8, 'session/end-seed', {}, 1_075),
      event(9, 'turn/start', { turn: 2 }, 1_080),
      event(10, 'compaction/start', { compactionId: 'compact-a', turn: 2 }, 1_085),
      event(11, 'compaction/summary', {
        compactionId: 'compact-a',
        summary: { content: [{ type: 'text', text: '历史摘要' }] }
      }, 1_087),
      event(12, 'compaction/end', { compactionId: 'compact-a', turn: 2 }, 1_088),
      event(13, 'step/start', { turn: 2, step: 1 }, 1_090),
      event(14, 'request/header', {
        header: { system: '系统提示词', tools: [], config: { model: 'deepseek-chat' } },
        reason: 'initial'
      }, 1_100),
      event(15, 'assistant/message', {
        turn: 2,
        step: 1,
        message: { content: [{ type: 'text', text: '新轮第一次' }] }
      }, 1_110)
    ])

    expect(result.records.map((record) => record.kind)).toEqual([
      'assistant', 'assistant', 'compaction', 'assistant'
    ])
    expect(result.records.flatMap((record) => record.requests.map((request) => request.number))).toEqual([1, 2, 3, 4])
    expect(result.records[2]).toMatchObject({
      status: 'complete',
      output: '历史摘要',
      requests: [{ number: 3, reason: 'compaction', step: null, status: 'complete' }]
    })
    expect(result.records[3]).toMatchObject({
      requests: [{ number: 4, seq: 13, turn: 2, step: 1 }]
    })
    expect(() => agentTrajectorySnapshotSchema.parse({
      conversationId: 'conversation-a',
      runtimeThreadId: 'thread-a',
      records: result.records,
      totalRecords: result.records.length,
      hasMore: false,
      beforeIndex: result.records[0]?.index ?? null,
      startedAtMillis: result.startedAtMillis,
      completedAtMillis: result.completedAtMillis
    })).not.toThrow()
    expect(JSON.stringify(result)).not.toContain('系统提示词')
  })

  it('keeps request metadata without copying historical or current tool context into the ledger', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'user/message', { id: 'user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '上轮问题' }] }, 1_010, 'append'),
      event(2, 'step/start', { turn: 1, step: 1 }, 1_020),
      event(3, 'assistant/message', { turn: 1, step: 1, message: {
        id: 'call-1', role: 'assistant', source: { kind: 'model' }, content: [
          { type: 'reasoning', text: '上轮推理' },
          { type: 'tool-call', id: 'tool-1', name: 'lookup', arguments: '{}' }
        ]
      } }, 1_030, 'append'),
      event(4, 'tool/result', { turn: 1, step: 1, message: {
        id: 'result-1', role: 'user', source: { kind: 'tool', callId: 'tool-1' },
        content: [{ type: 'tool-result', toolCallId: 'tool-1', content: [{ type: 'text', text: '上轮工具结果' }] }]
      } }, 1_040, 'append'),
      event(5, 'step/end', { turn: 1, step: 1 }, 1_050),
      event(6, 'step/start', { turn: 1, step: 2 }, 1_060),
      event(7, 'assistant/message', { turn: 1, step: 2, message: {
        id: 'reply-1', role: 'assistant', source: { kind: 'model' }, content: [
          { type: 'reasoning', text: '上轮最终推理' },
          { type: 'text', text: '<FINAL>上轮答复</FINAL>' }
        ]
      } }, 1_070, 'append'),
      event(8, 'turn/end', { turn: 1 }, 1_080),
      event(9, 'turn/start', { turn: 2 }, 1_090),
      event(10, 'user/message', { id: 'user-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '本轮问题' }] }, 1_100, 'append'),
      event(11, 'user/message', { id: 'runtime-2', role: 'user', source: { kind: 'plugin:runtime-context' },
        content: [{ type: 'text', text: '本轮运行上下文' }] }, 1_110, 'append'),
      event(12, 'step/start', { turn: 2, step: 1 }, 1_120),
      event(13, 'assistant/message', { turn: 2, step: 1, message: {
        id: 'call-2', role: 'assistant', source: { kind: 'model' }, content: [
          { type: 'reasoning', text: '本轮推理' },
          { type: 'tool-call', id: 'tool-2', name: 'lookup', arguments: '{}' }
        ]
      } }, 1_130, 'append'),
      event(14, 'tool/result', { turn: 2, step: 1, message: {
        id: 'result-2', role: 'user', source: { kind: 'tool', callId: 'tool-2' },
        content: [{ type: 'tool-result', toolCallId: 'tool-2', content: [{ type: 'text', text: '本轮工具结果' }] }]
      } }, 1_140, 'append'),
      event(15, 'step/end', { turn: 2, step: 1 }, 1_150),
      event(16, 'step/start', { turn: 2, step: 2 }, 1_160),
      event(17, 'assistant/message', { turn: 2, step: 2, message: {
        id: 'reply-2', role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '<FINAL>本轮答复</FINAL>' }]
      } }, 1_170, 'append')
    ])
    const requests = result.records.flatMap((record) => record.requests).filter((request) => request.turn === 2)

    expect(requests).toHaveLength(2)
    expect(requests[0]).not.toHaveProperty('context')
    expect(requests[1]).not.toHaveProperty('context')
    expect(JSON.stringify(requests)).not.toContain('上轮推理')
    expect(JSON.stringify(requests)).not.toContain('上轮工具结果')
    expect(JSON.stringify(requests)).not.toContain('上轮最终推理')
  })

  it('keeps compaction request metadata without eagerly reconstructing its context', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'user/message', { role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '压缩前的问题' }] }, 1_010, 'append'),
      event(2, 'assistant/message', { turn: 1, step: 1, message: {
        role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '<FINAL>压缩前的答复</FINAL>' }]
      } }, 1_020, 'append'),
      {
        ...event(3, 'user/message', { role: 'user', source: { kind: 'compact-checkpoint' },
          content: [{ type: 'text', text: '<compacted-summary>历史摘要</compacted-summary>' }] }, 1_030),
        surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 }
      },
      event(4, 'user/message', { role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '摘要后的问题' }] }, 1_040, 'append'),
      event(5, 'assistant/message', { turn: 2, step: 1, message: {
        role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '<FINAL>摘要后的答复</FINAL>' }]
      } }, 1_050, 'append'),
      event(6, 'turn/start', { turn: 3 }, 1_060),
      event(7, 'user/message', { role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: '当前问题' }] }, 1_070, 'append'),
      event(8, 'step/start', { turn: 3, step: 1 }, 1_080),
      event(9, 'assistant/message', { turn: 3, step: 1, message: {
        role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'text', text: '<FINAL>当前答复</FINAL>' }]
      } }, 1_090, 'append')
    ])

    const request = result.records.flatMap((record) => record.requests).find(request => request.turn === 3)
    expect(request).not.toHaveProperty('context')
  })

  it('does not project headerless constructor seed steps as model requests', () => {
    const result = projectDshTrajectory([
      event(0, 'turn/start', { turn: 1 }, 1_000),
      event(1, 'step/start', { turn: 1, step: 1 }, 1_010),
      event(2, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: '合成历史消息' }] }
      }, 1_020),
      event(3, 'turn/end', { turn: 1 }, 1_030),
      event(4, 'session/end-seed', {}, 1_040),
      event(5, 'turn/start', { turn: 2 }, 1_050),
      event(6, 'step/start', { turn: 2, step: 1 }, 1_060),
      event(7, 'request/header', {
        header: { tools: [], config: { model: 'deepseek-chat' } },
        reason: 'initial'
      }, 1_070),
      event(8, 'assistant/message', {
        turn: 2,
        step: 1,
        message: { content: [{ type: 'text', text: '真实模型回复' }] }
      }, 1_080)
    ])

    expect(result.records.map((record) => record.requests.map((request) => request.number))).toEqual([[], [1]])
  })

})

function event(
  seq: number,
  type: string,
  data: SessionFormatJsonObject,
  time: number,
  surfaceOp?: 'append'
): SessionFormatEvent {
  return { seq, type, data, time, ...(surfaceOp === undefined ? {} : { surfaceOp }) }
}

function currentSessionRows(
  id: string,
  createdAt: number,
  events: ReturnType<typeof event>[]
): unknown[] {
  const header = {
    version: sessionFormatCatalog.currentVersion,
    id,
    createdAt,
    cwd: fixtureWorkspace,
    isSeeded: false,
    delegationDepth: 0
  }
  return [
    sessionFormatCatalog.encodeCurrentHeader(header, 0),
    ...events.map((item) => sessionFormatCatalog.encodeCurrentEvent(item))
  ]
}
