import { ChatPanel } from "../../modules/chat/index.js";

export function RoleplayPanel({ renderRoleplay, ...props }) {
  if (!renderRoleplay) return <ChatPanel {...props} />;
  return renderRoleplay({ component: ChatPanel, props });
}
