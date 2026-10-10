import { z } from 'zod'

export const agentTrajectoryRecordKindSchema = z.enum([
  'system',
  'user',
  'context',
  'assistant',
  'tool',
  'compaction'
])

export const agentTrajectoryRecordStatusSchema = z.enum([
  'running',
  'complete',
  'error',
  'cancelled'
])

export const agentRequestContextItemSchema = z.object({
  order: z.number().int().positive(),
  messageId: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  kind: z.enum(['system', 'prompt', 'history', 'user', 'assistant', 'tool', 'context']),
  title: z.string(),
  source: z.string(),
  anchor: z.string(),
  content: z.string()
})

export const agentTrajectoryRequestSchema = z.object({
  purpose: z.enum(['assistant', 'compaction']),
  number: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  turn: z.number().int().positive().nullable(),
  step: z.number().int().positive().nullable(),
  status: agentTrajectoryRecordStatusSchema,
  reason: z.string(),
  provider: z.string(),
  model: z.string(),
  requestConfig: z.record(z.string(), z.unknown()).nullable(),
  usage: z.object({
    input: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    reasoning: z.number().int().nonnegative().optional()
  }).nullable(),
  cumulativeUsage: z.object({
    input: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    reasoning: z.number().int().nonnegative().optional()
  }).nullable(),
  detail: z.string(),
  rawJson: z.string(),
  timeMillis: z.number().int().nonnegative().nullable(),
  durationMillis: z.number().int().nonnegative().nullable(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  firstTokenTime: z.number().int().nonnegative().nullable(),
  resultSeq: z.number().int().nonnegative().nullable()
})

export const agentTrajectoryRecordSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  kind: agentTrajectoryRecordKindSchema,
  title: z.string(),
  preview: z.string(),
  source: z.string(),
  input: z.string(),
  output: z.string(),
  detail: z.string(),
  rawJson: z.string(),
  timeMillis: z.number().int().nonnegative().nullable(),
  durationMillis: z.number().int().nonnegative().nullable(),
  turn: z.number().int().positive().nullable(),
  step: z.number().int().positive().nullable(),
  status: agentTrajectoryRecordStatusSchema,
  requests: z.array(agentTrajectoryRequestSchema)
})

export const agentTrajectorySnapshotSchema = z.object({
  conversationId: z.string().min(1),
  runtimeThreadId: z.string().min(1).nullable(),
  records: z.array(agentTrajectoryRecordSchema),
  totalRecords: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  beforeIndex: z.number().int().positive().nullable(),
  startedAtMillis: z.number().int().nonnegative().nullable(),
  completedAtMillis: z.number().int().nonnegative().nullable()
})

export type AgentTrajectoryRecord = z.infer<typeof agentTrajectoryRecordSchema>
export type AgentTrajectoryRequest = z.infer<typeof agentTrajectoryRequestSchema>
export type AgentRequestContextItem = z.infer<typeof agentRequestContextItemSchema>
export type AgentTrajectorySnapshot = z.infer<typeof agentTrajectorySnapshotSchema>
