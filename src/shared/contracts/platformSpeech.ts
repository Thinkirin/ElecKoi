/** Native synthesis contract used by both desktop and Android's shared Web client. */
export interface PlatformSpeechVoice {
  id: string
  name: string
  locale: string
  networkRequired: boolean
  provider: 'system'
}

export interface PlatformSpeechRequest {
  id: string
  text: string
  voiceId?: string
  voice?: string
  speed?: number
  pitch?: number
}

export interface PlatformSpeechAudio {
  id: string
  token: string
  bytes: number
  mimeType: 'audio/wav'
  voiceId: string
  status: 'completed'
}

export interface PlatformSpeechBridge {
  voices(): Promise<PlatformSpeechVoice[]>
  synthesize(request: PlatformSpeechRequest): Promise<PlatformSpeechAudio>
  cancel(id: string): Promise<boolean>
  readAudio(token: string, offset: number, count?: number): Promise<{ base64: string; bytes: number }>
  releaseAudio(token: string): Promise<boolean>
}
