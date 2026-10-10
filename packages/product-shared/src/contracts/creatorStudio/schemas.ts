import { z } from 'zod'

export const creatorProjectModeSchema = z.enum(['blank', 'existing'])

export const creatorProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  mode: creatorProjectModeSchema,
  rootPath: z.string().min(1),
  sourceCharacterId: z.string(),
  coverImage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const creatorProjectCollectionSchema = z.object({
  items: z.array(creatorProjectSchema)
})

export type CreatorProject = z.infer<typeof creatorProjectSchema>
export type CreatorProjectMode = z.infer<typeof creatorProjectModeSchema>
export type CreatorProjectCollection = z.infer<typeof creatorProjectCollectionSchema>
