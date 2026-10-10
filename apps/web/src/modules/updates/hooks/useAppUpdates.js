import { useCallback, useEffect, useMemo, useState } from "react";
export function useAppUpdates() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const updates = window.dshDesktop.updates;
    if (!updates) {
      setError("更新服务暂时不可用。");
      return undefined;
    }
    const unsubscribe = updates.subscribe((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
      setError("");
    });
    void updates.status().then((nextStatus) => {
      if (!active) return;
      setStatus(nextStatus);
      setError("");
    }).catch((cause) => {
      if (active) setError(cause?.message || "无法读取版本信息。");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const requestStatus = useCallback(async (request) => {
    setError("");
    try {
      const nextStatus = await request();
      setStatus(nextStatus);
      return nextStatus;
    } catch (cause) {
      setError(cause?.message || "更新服务暂时不可用。");
      throw cause;
    }
  }, []);

  const check = useCallback(() => requestStatus(() => {
    const updates = window.dshDesktop.updates;
    if (!updates) throw new Error("更新服务暂时不可用。");
    return updates.check();
  }), [requestStatus]);
  const download = useCallback(() => requestStatus(() => {
    const updates = window.dshDesktop.updates;
    if (!updates) throw new Error("更新服务暂时不可用。");
    return updates.download();
  }), [requestStatus]);
  const install = useCallback(async () => {
    setError("");
    try {
      const updates = window.dshDesktop.updates;
      if (!updates) throw new Error("更新服务暂时不可用。");
      return await updates.install();
    } catch (cause) {
      setError(cause?.message || "无法启动安装。");
      throw cause;
    }
  }, []);

  return useMemo(() => ({ status, error, check, download, install }), [check, download, error, install, status]);
}
