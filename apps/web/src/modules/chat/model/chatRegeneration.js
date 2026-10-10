export function findLatestRegenerateTargetMessageId(items) {
  if (!Array.isArray(items)) return "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const id = String(item?.id || "").trim();
    if (!id || id === "opening" || item?.pending) continue;
    if (item?.role === "user" || item?.role === "assistant") {
      return String(item?.turnId || id).trim();
    }
  }
  return "";
}

export function findRegenerateBranchUserIndex(items, targetMessageId = "", editingUserInput = false) {
  const targetId = String(targetMessageId || "").trim();
  if (!targetId) return -1;
  const targetIndex = items.findIndex((item) => item?.id === targetId || item?.turnId === targetId);
  if (targetIndex < 0) return -1;
  if (items[targetIndex]?.role === "assistant") {
    const target = items[targetIndex];
    if (Number.isSafeInteger(target.inputEventSeq)) return items.findIndex(input => input?.role === 'user'
      && input.runtimeSessionId === target.runtimeSessionId && input.sessionEventSeq === target.inputEventSeq);
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const input = items[index];
      if (input?.role !== "user") continue;
      const sameDshTurn = target.runtimeSessionId && input.runtimeSessionId === target.runtimeSessionId
        && Number.isSafeInteger(target.dshTurn) && input.dshTurn === target.dshTurn;
      const sameProductTurn = target.turnId && input.turnId === target.turnId;
      if (sameDshTurn || sameProductTurn) return index;
    }
    return -1;
  }
  if (items[targetIndex]?.role === "user") return targetIndex;
  return -1;
}
