export function conversationPreviewText(value) {
  return String(value || "")
    .replace(/<\/?FINAL>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
