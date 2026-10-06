import { randomUUID } from 'node:crypto';
import { createUserMessage, createSystemMessage, createAssistantMessage, createToolResultMessage, freezeMessage } from '@deepseek-ai/dsh-llm';
import { protocolFor, providerRequest } from './generation-protocol.js';

export const MAIN_GENERATION_METHODS = ['chat.generateFromHistory'];
const text = message => typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('');

/** Main-chat generation remains a durable Agent turn, including its tools and follow-up steps. */
export class MainAgentGeneration {
  constructor({ ctx, generation, callbacks, publish }) {
    Object.assign(this, { ctx, generation, callbacks, publish }); this.running = new Map(); this.closed = false;
  }
  service(name) { const value = this.ctx.get(name, false); if (!value) throw new Error(`Main Agent service is not mounted: ${name}`); return value; }
  claimNativeTurn(session, event) {
    const task = [...this.running.values()].find(task => task.sessionId === session.id);
    if (!task || task.nativeTurn) return false;
    task.nativeTurn = { session, startSeq: event.seq, turn: event.data.turn };
    return true;
  }
  async invoke({ params }) {
    if (this.closed) throw new Error('Main Agent generation Host is closed');
    const conversationId = params.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) throw new TypeError('Main Agent generation requires a conversationId');
    this.ctx.eleckoiProductData.readConversationDetails(conversationId);
    const type = params.type || 'normal';
    if (!['normal', 'continue', 'regenerate', 'swipe'].includes(type)) throw new Error(`Unknown main Agent generation mode: ${type}`);
    const options = { ...params.options, type, ...(params.speakerId ? { speakerId: params.speakerId } : {}) };
    if (options.responseLength !== undefined && (!Number.isSafeInteger(options.responseLength) || options.responseLength <= 0)) throw new TypeError('responseLength must be a positive token count');
    if (options.speakerId && !this.ctx.eleckoiProductData.readCharacters().items.some(character => character.id === options.speakerId)) throw new Error(`Character does not exist: ${options.speakerId}`);
    if (options.jsonSchema && (typeof options.jsonSchema !== 'object' || !(options.jsonSchema.value || options.jsonSchema.schema))) throw new TypeError('jsonSchema requires a value/schema object');
    if (this.running.has(conversationId)) throw new Error('Agent generation is already running in this chat');
    const controller = this.ctx.sessionController, sessionId = this.ctx.eleckoiProductData.runtimeSessionId(conversationId);
    const resolved = await controller.resolveAgent(sessionId);
    if ('error' in resolved) throw resolved.error;
    const agent = resolved.agent;
    if (agent.status === 'running') throw new Error('Agent generation is already running in this chat');
    const messages = this.service('eleckoiCompatibilityMessages'), sessions = this.service('eleckoiRoleplaySessions');
    const history = await messages.read(conversationId), last = history.at(-1), sourceUser = history.findLast(message => message.role === 'user');
    const oldReply = ['continue', 'regenerate', 'swipe'].includes(type) ? history.findLast(message => message.role === 'assistant') : undefined;
    if (type === 'continue' && (!oldReply || last?.id !== oldReply.id)) throw new Error('Continue requires the final assistant reply');
    if (['regenerate', 'swipe'].includes(type) && (!sourceUser || !Number.isSafeInteger(sourceUser.sessionEventSeq))) throw new Error('Regeneration requires a real preceding Session user message');
    const prompt = ['regenerate', 'swipe'].includes(type) ? sourceUser.content : type === 'continue'
      ? `Continue the last assistant reply from exactly where it ended.${options.quiet_prompt ? '\n' + options.quiet_prompt : ''}`
      : options.quiet_prompt || 'Write the next assistant reply using the conversation history.';
    if (['regenerate', 'swipe'].includes(type)) {
      // Preview retains the source Session. Real regeneration rewinds past the
      // source user before preparing its prompt, so that ID no longer exists.
      if (options.dryRun === true) options.historyCutoffId = sourceUser.id;
      else delete options.historyCutoffId;
    }
    if (options.quietImage) options.promptImages = await this.service('attachments').admitPromptContent([await imageInput(options.quietImage)]);
    if (options.dryRun === true) return sessions.withGenerationOptions(conversationId, options, async () => {
      const preview = await sessions.previewPrompt(conversationId, prompt);
      const request = { provider: preview.model.provider, model: preview.model.model, messages: preview.messages, stream: true,
        ...(preview.model.maxTokens ? { maxTokens: preview.model.maxTokens } : {}) };
      const prepared = await this.beforeRequest(request, preview.conversationContext, true);
      return { ...preview, messages: wireMessages(prepared.request?.messages || preview.messages), request: prepared.body || prepared.request };
    });
    const task = { conversationId, sessionId, type, agent, options, oldReply, sourceUser, beforeSeq: 0, abort: new AbortController(), admitted: false };
    this.running.set(conversationId, task);
    try {
      task.beforeSeq = (await controller.inspect(sessionId)).events.at(-1)?.seq ?? 0;
      await sessions.withGenerationOptions(conversationId, options, async () => {
        if (['regenerate', 'swipe'].includes(type)) {
          const requestId = randomUUID();
          const prepared = await this.ctx.eleckoiConversationsApi.regenerateMessage(conversationId, sourceUser.sessionEventSeq, requestId);
          task.operationId = prepared.operationId;
          task.beforeSeq = (await controller.inspect(sessionId)).events.at(-1)?.seq ?? 0;
          // Native rewind closes the original Session and Agent. Completion
          // belongs to the replacement Agent used by startRegeneration.
          const replacement = await controller.resolveAgent(sessionId);
          if ('error' in replacement) throw replacement.error;
          task.agent = replacement.agent;
          task.abort.signal.throwIfAborted();
          const result = await this.ctx.eleckoiConversationsApi.startRegeneration(conversationId, requestId, false);
          if (!result.accepted) throw new Error('Agent regeneration was rejected');
          task.admitted = true;
        } else {
          const prepared = await this.ctx.eleckoiConversationsApi.preparePrompt(conversationId, prompt, task.abort.signal);
          task.operationId = prepared.operationId;
          task.abort.signal.throwIfAborted();
          const content = [{ type: 'text', text: prompt }];
          agent.followup(createUserMessage({ source: { kind: 'eleckoi-generation', conversationId, generationType: type }, content }));
          task.admitted = true;
        }
      });
      this.publish({ event: 'agent.state.changed', payload: { conversationId, runId: sessionId, nativeMain: true, state: 'starting', type } });
      task.done = this.finish(task, messages).catch(error => {
        this.publish({ event: 'agent.run.failed', payload: { conversationId, runId: sessionId, nativeMain: true, message: error.message || String(error) } });
      }).finally(() => this.running.delete(conversationId));
      return { accepted: true, conversationId, runId: sessionId, nativeMain: true };
    } catch (error) {
      if (task.operationId && !task.admitted) this.ctx.eleckoiConversationLifecycle.forget(conversationId);
      this.running.delete(conversationId);
      throw error;
    }
  }
  async finish(task, messages) {
    await task.agent.whenIdle();
    const inspection = await this.ctx.sessionController.inspect(task.sessionId);
    const end = inspection.events.findLast(event => event.type === 'turn/end' && event.seq > task.beforeSeq
      && (!task.nativeTurn || event.data?.turn === task.nativeTurn.turn && event.seq > task.nativeTurn.startSeq)), reason = end?.data?.reason;
    if (!end) throw new Error('Main Agent did not commit a turn/end event');
    await this.ctx.eleckoiConversationsApi.waitForGeneration(task.conversationId, task.operationId);
    if (reason?.kind === 'error') throw new Error(reason.error?.message || 'Main Agent generation failed');
    if (['aborted', 'interrupted'].includes(reason?.kind)) {
      this.publish({ event: 'agent.state.changed', payload: { conversationId: task.conversationId, runId: task.sessionId, nativeMain: true, state: 'idle', detail: 'stopped' } }); return;
    }
    let history = await messages.read(task.conversationId), reply = history.findLast(message => message.role === 'assistant'
      && (!task.nativeTurn || message.sessionEventSeq > task.nativeTurn.startSeq && message.sessionEventSeq < end.seq));
    if (!reply || reply.id === task.oldReply?.id && task.type !== 'continue') throw new Error('Main Agent completed without a new assistant reply');
    if (task.type === 'continue') {
      const content = String(task.oldReply.content) + String(reply.content);
      await messages.invoke({ method: 'messages.update', params: { conversationId: task.conversationId, messages: [{ id: task.oldReply.id,
        content, reasoning: [task.oldReply.reasoning, reply.reasoning].filter(Boolean).join('\n') }] } });
      if (reply.id !== task.oldReply.id) await messages.invoke({ method: 'messages.delete', params: { conversationId: task.conversationId, ids: [reply.id] } });
    } else if (task.type === 'swipe' && task.oldReply) {
      const swipes = [...(task.oldReply.swipes || [task.oldReply.content]), reply.content];
      const swipesInfo = [...(task.oldReply.swipes_info || []), { extra: { reasoning: reply.reasoning || '' } }];
      await messages.invoke({ method: 'messages.update', params: { conversationId: task.conversationId,
        messages: [{ id: reply.id, swipes, swipes_info: swipesInfo, swipe_id: swipes.length - 1 }] } });
    }
    if (task.options.speakerId || task.options.force_name2 || task.options.quietName) await messages.invoke({ method: 'messages.update', params: {
      conversationId: task.conversationId, messages: [{ id: task.type === 'continue' ? task.oldReply.id : reply.id,
        ...(task.options.speakerId ? { speakerId: task.options.speakerId } : {}),
        ...(task.options.quietName ? { name: task.options.quietName } : task.options.force_name2 ? { name: this.ctx.eleckoiProductData.readCharacters().items.find(character => character.id === task.options.speakerId)?.name || reply.name } : {}) }] } });
    if (this.ctx.eleckoiConversationsApi.completeGroupRound) await this.ctx.eleckoiConversationsApi.completeGroupRound(task.conversationId, false, task.abort.signal);
    const replyId = task.type === 'continue' ? task.oldReply.id : reply.id;
    history = await messages.read(task.conversationId); reply = history.find(message => message.id === replyId);
    if (!reply) throw new Error('Main Agent committed reply is no longer available');
    this.publish({ event: 'agent.run.finished', payload: { conversationId: task.conversationId, runId: task.sessionId,
      nativeMain: true, message: reply, messageCount: history.length } });
  }
  async beforeRequest(request, context, dryRun = false) {
    const controls = context.mainGenerationOptions || {}, settings = context.compatibilityPreset?.compatibility ? { ...context.compatibilityPreset.settings } : {};
    if (controls.jsonSchema) settings.response_format = { type: 'json_schema', json_schema: { name: controls.jsonSchema.name || 'response',
      schema: controls.jsonSchema.value || controls.jsonSchema.schema, strict: controls.jsonSchema.strict ?? true } };
    if (controls.responseLength) request = { ...request, maxTokens: controls.responseLength };
    if (this.generation.requiresAdvancedSettings(settings) && !dryRun) return { stream: this.generation.streamWithSettings(request, settings,
      { conversationId: context.conversationId }) };
    if (!this.callbacks.hasClients()) return { request };
    const connection = await this.generation.connection({ conversationId: context.conversationId, configId: request.provider, model: request.model });
    const format = protocolFor(connection.api || ''), messages = await this.providerMessages(request.messages, request.signal);
    const params = { stream: true, presetSettings: settings, ...request, messages,
      tools: request.tools?.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };
    const body = await this.callbacks.callback('__ElecKoiBeforeProviderRequest', { conversationId: context.conversationId, format,
      request: providerRequest(format, request.model, messages, params), dryRun }, { conversationId: context.conversationId, signal: request.signal });
    if (dryRun) return { request, body };
    const nativeFields = new Set(['model', 'messages', 'stream', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'tools', 'stop']);
    if (format !== 'ChatCompletions' || Object.keys(body).some(key => !nativeFields.has(key))) return {
      stream: this.generation.streamWithSettings(request, settings, { conversationId: context.conversationId, preparedBody: body }) };
    if (!Array.isArray(body.messages)) throw new TypeError('Agent prompt hook must return a messages array');
    const native = [];
    for (const [index, message] of body.messages.entries()) {
      if (JSON.stringify(message) === JSON.stringify(messages[index])) native.push(request.messages[index]);
      else native.push(await this.fromHookMessage(message, request.messages[index], request.provider, body.model));
    }
    return { request: { ...request, model: body.model, messages: native,
      ...(body.temperature === undefined ? {} : { temperature: body.temperature }), ...(body.top_p === undefined ? {} : { topP: body.top_p }),
      ...(body.max_completion_tokens ?? body.max_tokens ? { maxTokens: body.max_completion_tokens ?? body.max_tokens } : {}),
      ...(body.stop ? { stop: body.stop } : {}), ...(body.tools ? { tools: body.tools.map(tool => tool.function) } : {}) } };
  }
  async *streamRequest(request, context) {
    const prepared = await this.beforeRequest(request, context);
    yield* prepared.stream || this.ctx.llm.stream(prepared.request);
  }
  async providerMessages(messages, signal) {
    const result = wireMessages(messages);
    for (const [index, message] of messages.entries()) {
      const content = [];
      for (const block of message.content || []) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'image' || block.type === 'file') {
          if (!this.generation.projectBlock) throw new Error('Main Agent attachment projection service is not mounted');
          content.push(await this.generation.projectBlock(block, signal));
        }
      }
      result[index].content = content.length === 1 && content[0].type === 'text' ? content[0].text : content;
    }
    return result;
  }
  async fromHookMessage(message, original, provider, model) {
    if (Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')) {
      const content = [];
      for (const part of message.content) {
        if (part.type === 'image_url') content.push(...await this.service('attachments').admitPromptContent([await imageInput(part.image_url?.url || part.image_url)]));
        else if (part.type === 'text') content.push(part);
        else throw new Error(`Invalid main Agent prompt hook content block: ${part.type}`);
      }
      message = { ...message, content };
    }
    return fromWireMessage(message, original, provider, model);
  }
  async close() {
    this.closed = true;
    for (const task of this.running.values()) { task.abort.abort(); task.agent.cancel({ kind: 'user' }); }
    await Promise.all([...this.running.values()].map(task => task.done).filter(Boolean)); this.running.clear();
  }
}

export function wireMessages(messages) {
  return messages.map(message => {
    const content = [], calls = [];
    for (const block of message.content || []) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'tool-call') calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } });
      else if (block.type !== 'reasoning') content.push(block);
    }
    return { role: message.role, content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
      ...(calls.length ? { tool_calls: calls } : {}), ...(message.role === 'tool' ? { tool_call_id: message.toolCallId,
        ...(message.isError === undefined ? {} : { is_error: message.isError }) } : {}) };
  });
}

function fromWireMessage(message, original, provider, model) {
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content || [];
  const tools = (message.tool_calls || []).map(call => ({ type: 'tool-call', id: call.id, name: call.function.name, arguments: call.function.arguments }));
  if (original?.role === message.role) return freezeMessage({ ...original, content: [...content, ...tools] });
  if (message.role === 'user') return createUserMessage({ content, source: { kind: 'plugin:main-generation' } });
  if (message.role === 'system') return createSystemMessage(text({ content }));
  if (message.role === 'assistant') return createAssistantMessage({ content: [...content, ...tools], source: { provider, model } });
  if (message.role === 'tool') return createToolResultMessage({ content, callId: message.tool_call_id, isError: message.is_error ?? false });
  throw new Error(`Invalid Agent prompt hook role: ${message.role}`);
}

async function imageInput(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('quietImage must be an image URL');
  const response = await fetch(value);
  if (!response.ok) throw new Error(`quietImage HTTP ${response.status}`);
  const mediaType = response.headers.get('content-type')?.split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new TypeError('quietImage must be a supported image');
  return { type: 'image', mediaType, data: Buffer.from(await response.arrayBuffer()).toString('base64') };
}
