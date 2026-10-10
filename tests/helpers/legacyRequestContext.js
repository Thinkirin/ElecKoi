import { projectProductHistory, projectRequestMessages, requestContextItems } from '../../packages/dsh-client-roleplay/src/host/conversation-context.mjs'

/** Build the request annotation used by the supported legacy migration fixtures. */
export function legacyFixtureRequest(messages) {
  const envelope = messages.findLast(message => message.source.kind === 'plugin:eleckoi-request-projection')
  const prefix = 'ELECKOI_REQUEST_PROJECTION_V2\n'
  if (!envelope?.content[0]?.text.startsWith(prefix)) throw new Error('Legacy fixture lacks its V2 envelope')
  const snapshot = JSON.parse(envelope.content[0].text.slice(prefix.length))
  return requestContextItems(projectRequestMessages(projectProductHistory(messages, snapshot), snapshot.plan), snapshot.plan)
}
