import React from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { OfficialMarkdownProvider } from '../../apps/web/src/ui/messages/OfficialMarkdown.jsx'
import { MessageBubble as ProductMessageBubble } from '../../apps/web/src/ui/messages/MessageBubble.jsx'
import { MessageList as ProductMessageList } from '../../apps/web/src/modules/chat/components/ChatPanel.jsx'

export function WithOfficialMarkdown({ children }) {
  return <OfficialMarkdownProvider component={MarkdownText}>{children}</OfficialMarkdownProvider>
}

export function MessageBubble(props) {
  return <WithOfficialMarkdown><ProductMessageBubble {...props} /></WithOfficialMarkdown>
}

export function MessageList(props) {
  return <WithOfficialMarkdown><ProductMessageList {...props} /></WithOfficialMarkdown>
}
