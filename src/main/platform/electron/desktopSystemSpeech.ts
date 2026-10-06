import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { PlatformSpeechAudio, PlatformSpeechRequest, PlatformSpeechVoice } from '../../../shared/contracts/platformSpeech'

// Only fixed program text goes to PowerShell. Text, voice and output paths travel as JSON on stdin.
const windowsSpeechProgram = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speech = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  if ($request.operation -eq 'voices') {
    $voices = @($speech.GetInstalledVoices() | Where-Object Enabled | ForEach-Object {
      $voice = $_.VoiceInfo
      @{ id = $voice.Name; name = $voice.Name; locale = $voice.Culture.Name; networkRequired = $false; provider = 'system' }
    })
    ConvertTo-Json -InputObject $voices -Compress
  } elseif ($request.operation -eq 'synthesize') {
    if ($request.voice) { $speech.SelectVoice([string]$request.voice) }
    $speech.SetOutputToWaveFile([string]$request.path)
    $text = [System.Security.SecurityElement]::Escape([string]$request.text)
    $language = [System.Security.SecurityElement]::Escape($speech.Voice.Culture.Name)
    $rate = ([double]$request.speed * 100).ToString('0.###', [Globalization.CultureInfo]::InvariantCulture) + '%'
    $pitchNumber = ([double]$request.pitch - 1) * 100
    $pitch = $pitchNumber.ToString('+0.###;-0.###;0', [Globalization.CultureInfo]::InvariantCulture) + '%'
    $speech.SpeakSsml('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + $language + '"><prosody rate="' + $rate + '" pitch="' + $pitch + '">' + $text + '</prosody></speak>')
    $speech.SetOutputToNull()
    ConvertTo-Json -InputObject @{ voiceId = $speech.Voice.Name } -Compress
  } else { throw 'Unknown Windows speech operation' }
} finally { $speech.Dispose() }
`

function cancelled(): Error {
  return Object.assign(new Error('System TTS cancelled'), { name: 'AbortError' })
}

async function windowsSpeech(request: object, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsSpeechProgram, 'utf16le').toString('base64')], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  })
  return await new Promise((resolve, reject) => {
    let stdout = '', stderr = ''
    const stop = (): void => { child.kill() }
    signal.addEventListener('abort', stop, { once: true })
    child.stdout.setEncoding('utf8').on('data', (part: string) => { stdout += part })
    child.stderr.setEncoding('utf8').on('data', (part: string) => { stderr += part })
    child.stdin.on('error', (error) => { if (!signal.aborted) reject(error) })
    child.on('error', reject)
    child.on('close', code => {
      signal.removeEventListener('abort', stop)
      if (signal.aborted) { reject(signal.reason ?? cancelled()); return }
      if (code !== 0) { reject(new Error(`Windows system TTS failed (${code}): ${stderr.trim()}`)); return }
      try { resolve(JSON.parse(stdout.trim())) }
      catch (error) { reject(new Error('Windows system TTS returned invalid JSON', { cause: error })) }
    })
    child.stdin.end(JSON.stringify(request))
  })
}

/** OS synthesis only. Jobs, settings and audio storage remain owned by the common Host. */
export class DesktopSystemSpeech {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<PlatformSpeechAudio> }>()
  private readonly controls = new Set<AbortController>()
  private readonly outputs = new Map<string, { path: string; bytes: number }>()
  private readonly directory = mkdtemp(join(tmpdir(), 'eleckoi-system-speech-'))
  private closed = false

  private assertAvailable(): void {
    if (this.closed) throw new Error('Desktop system TTS is closed')
    if (process.platform !== 'win32') throw new Error(`System TTS file synthesis is unavailable on desktop platform: ${process.platform}`)
  }

  async voices(): Promise<PlatformSpeechVoice[]> {
    this.assertAvailable()
    const controller = new AbortController()
    this.controls.add(controller)
    try {
      const result = await windowsSpeech({ operation: 'voices' }, controller.signal)
      if (!Array.isArray(result)) throw new Error('Windows system TTS voices must be an array')
      return result as PlatformSpeechVoice[]
    } finally { this.controls.delete(controller) }
  }

  synthesize(request: PlatformSpeechRequest): Promise<PlatformSpeechAudio> {
    this.assertAvailable()
    if (!request || typeof request.id !== 'string' || !request.id || typeof request.text !== 'string' || !request.text.trim()) {
      throw new TypeError('System TTS requires an id and nonempty text')
    }
    for (const value of [request.speed ?? 1, request.pitch ?? 1]) {
      if (!Number.isFinite(value) || value <= 0) throw new TypeError('System TTS speed and pitch must be positive finite values')
    }
    if (this.jobs.has(request.id)) throw new Error(`System TTS id already running: ${request.id}`)
    const controller = new AbortController()
    const done = this.synthesizeFile(request, controller.signal)
    this.jobs.set(request.id, { controller, done })
    // finally() would create an unobserved rejecting Promise when a caller cancels.
    void done.then(() => this.jobs.delete(request.id), () => this.jobs.delete(request.id))
    return done
  }

  private async synthesizeFile(request: PlatformSpeechRequest, signal: AbortSignal): Promise<PlatformSpeechAudio> {
    const token = randomUUID(), path = join(await this.directory, token + '.wav')
    try {
      signal.throwIfAborted()
      const result = await windowsSpeech({ operation: 'synthesize', path, text: request.text,
        voice: request.voiceId || request.voice || '', speed: request.speed ?? 1, pitch: request.pitch ?? 1 }, signal) as { voiceId?: unknown }
      signal.throwIfAborted()
      const bytes = (await stat(path)).size
      if (bytes <= 44 || typeof result.voiceId !== 'string') throw new Error('Windows system TTS produced no usable audio')
      const file = await open(path, 'r')
      try {
        const header = Buffer.alloc(12)
        await file.read(header, 0, 12, 0)
        if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
          throw new Error('Windows system TTS produced an invalid WAV file')
        }
      } finally { await file.close() }
      signal.throwIfAborted()
      this.outputs.set(token, { path, bytes })
      return { id: request.id, token, bytes, mimeType: 'audio/wav', voiceId: result.voiceId, status: 'completed' }
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
  }

  async cancel(id: string): Promise<boolean> {
    if (typeof id !== 'string') throw new TypeError('System TTS cancel requires a task id')
    const job = this.jobs.get(id)
    if (!job) return false
    job.controller.abort(cancelled())
    await job.done.catch(error => { if (error.name !== 'AbortError') throw error })
    return true
  }

  async readAudio(token: string, offset: number, count = 65536): Promise<{ base64: string; bytes: number }> {
    const output = this.outputs.get(token)
    if (!output) throw new Error('Unknown desktop system TTS audio token')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > output.bytes || !Number.isSafeInteger(count) || count < 1 || count > 65536) {
      throw new RangeError('Invalid system TTS audio read range')
    }
    const buffer = Buffer.alloc(Math.min(count, output.bytes - offset)), file = await open(output.path, 'r')
    try {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      return { base64: buffer.subarray(0, bytesRead).toString('base64'), bytes: bytesRead }
    } finally { await file.close() }
  }

  async releaseAudio(token: string): Promise<boolean> {
    const output = this.outputs.get(token)
    if (!output) return false
    await rm(output.path)
    this.outputs.delete(token)
    return true
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const job of this.jobs.values()) job.controller.abort(cancelled())
    for (const controller of this.controls) controller.abort(cancelled())
    const results = await Promise.allSettled([...this.jobs.values()].map(job => job.done))
    const failures = results.flatMap(result => result.status === 'rejected' && result.reason.name !== 'AbortError' ? [result.reason] : [])
    this.outputs.clear()
    const directory = await this.directory, relativePath = relative(resolve(tmpdir()), resolve(directory))
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + sep)) throw new Error('System speech temporary path escaped the temp directory')
    await rm(directory, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'Desktop system TTS cleanup failed')
  }
}
