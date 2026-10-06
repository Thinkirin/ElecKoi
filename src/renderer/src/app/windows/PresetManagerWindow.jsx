import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadPresetFile,
  fileBase64,
  PresetImportDialog,
  PresetManager,
} from "../../modules/presets/index.js";
import { showCurrentWindow } from "../services/windowControls.js";
import { ProductWindowTitleBar } from "./ProductWindowTitleBar.jsx";

const ALL_PRESETS = "全部预设";

export function PresetManagerWindow({ presetCatalog, renderPresetManager }) {
  const [catalog, setCatalog] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(ALL_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const importInputRef = useRef(null);
  const importSourceRef = useRef("");

  const acceptCatalog = useCallback((next, preferredId = "") => {
    setCatalog(next);
    setSelectedPresetId((current) => {
      const requested = preferredId || current || next.activePresetId;
      return next.presets.some((preset) => preset.id === requested) ? requested : next.presets[0]?.id || "";
    });
    setSelectedGroup((current) => current === ALL_PRESETS || next.groups.some((group) => group.id === current) ? current : ALL_PRESETS);
    setLoadError("");
    return next;
  }, []);

  const refresh = useCallback(async (preferredId = "") => {
    try {
      return acceptCatalog(await presetCatalog.refresh(), preferredId);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "读取预设失败。");
      return null;
    }
  }, [acceptCatalog, presetCatalog]);

  useEffect(() => {
    document.title = "预设管理器 - ElecKoi";
    showCurrentWindow().catch(() => {});
    const update = () => {
      const snapshot = presetCatalog.getSnapshot();
      if (snapshot.status === "ready") acceptCatalog(snapshot.catalog);
      else if (snapshot.status === "error") setLoadError(snapshot.error);
    };
    const stop = presetCatalog.subscribe(update);
    update();
    void refresh();
    return stop;
  }, [acceptCatalog, presetCatalog, refresh]);

  function beginImport() {
    setImportError("");
    setImportDialogOpen(true);
  }

  function chooseImportSource(source) {
    importSourceRef.current = source;
    setImportDialogOpen(false);
    if (!importInputRef.current) return;
    importInputRef.current.accept = source === "sillytavern"
      ? "application/json,.json"
      : "image/png,application/json,.png,.json";
    importInputRef.current.click();
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 64 * 1024 * 1024) {
      setImportError("预设文件不能超过 64 MB");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const result = await presetCatalog.import(importSourceRef.current, {
        displayName: file.name,
        mimeType: file.type,
        base64: await fileBase64(file),
      });
      setSelectedGroup(ALL_PRESETS);
      await refresh(result.preset.id);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "导入预设失败。");
    } finally {
      setImporting(false);
    }
  }

  async function downloadPreset(format) {
    if (!selectedPresetId) return;
    setImportError("");
    downloadPresetFile(await presetCatalog.export(selectedPresetId, format));
  }

  const managerOwner = {
    catalog,
    selectedGroup,
    selectedPresetId,
    importing,
    importError,
    onSelectGroup: setSelectedGroup,
    onSelectPreset: setSelectedPresetId,
    onRefresh: refresh,
    onImport: beginImport,
    onExport: downloadPreset,
  };
  const managerFallback = catalog ? <PresetManager
    catalogModel={presetCatalog}
    catalog={catalog}
    selectedGroup={selectedGroup}
    selectedPresetId={selectedPresetId}
    onSelectGroup={setSelectedGroup}
    onSelectPreset={setSelectedPresetId}
    onRefresh={refresh}
    onImport={beginImport}
    onExport={downloadPreset}
    importing={importing}
    importError={importError}
  /> : null;

  return (
    <main className="qq-shell management-window-shell preset-management-window-shell">
      <ProductWindowTitleBar title="预设管理器" splitSurface />
      <section className="management-window-content preset-management-window-content">
        {!catalog && !loadError ? <p className="management-window-state">正在读取…</p> : loadError ? (
          <div className="management-window-state is-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void refresh()}>重试</button>
          </div>
        ) : (
          renderPresetManager?.(managerOwner, managerFallback) ?? managerFallback
        )}
      </section>
      <input ref={importInputRef} type="file" accept="image/png,application/json,.png,.json" hidden onChange={handleImport} />
      {importDialogOpen ? <PresetImportDialog onSelect={chooseImportSource} onClose={() => setImportDialogOpen(false)} /> : null}
    </main>
  );
}
