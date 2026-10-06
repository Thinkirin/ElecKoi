import { useEffect, useMemo, useState } from "react";
import {
  PluginArtworkDefault,
  PluginArtworkLoop,
  PluginArtworkSearch,
  PluginArtworkSubagent,
  PluginArtworkTerminal,
} from "../../../../ui/icons/dshPluginArtwork.jsx";
import { ChevronRightIcon } from "../../../../ui/icons/index.jsx";
import { DshSearchField } from "../../../../ui/ui/DshSearchField.jsx";
import { SidebarCreateButton } from "../../../../ui/ui/SidebarCreateButton.jsx";
import { useSidebarListScroll } from "../../../../ui/hooks/useSidebarListScroll.js";
import { LIST_COLLAPSE_AREAS, usePersistentCollapseState } from "../../../../modules/settings/index.js";
import "../styles/plugin-center.css";

const GROUPS = [
  { id: "official", label: "DSH 官方插件" },
  { id: "eleckoi", label: "ElecKoi 内置插件" },
  { id: "installed", label: "用户安装插件" },
];
const GROUP_IDS = GROUPS.map((group) => group.id);

const ITEM_ARTWORK = {
  shell: PluginArtworkTerminal,
  "agent-loop": PluginArtworkLoop,
  subagent: PluginArtworkSubagent,
  "web-search": PluginArtworkSearch,
};

function PluginIcon({ item }) {
  const [failedSource, setFailedSource] = useState("");
  const Artwork = item.kind === "item" ? ITEM_ARTWORK[item.id] || PluginArtworkDefault : PluginArtworkDefault;
  return <span className="plugin-list-icon">
    {item.icon && item.icon !== failedSource
      ? <img src={item.icon} alt="" onError={() => setFailedSource(item.icon)} />
      : <Artwork size={22} />}
  </span>;
}

export { applySidebarListWheel as applyPluginListWheel } from "../../../../ui/hooks/useSidebarListScroll.js";

export function PluginListPanel({ onNotify, onOpenDetail }) {
  const [entries, setEntries] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [collapsed, setCollapsed, collapseStateReady] = usePersistentCollapseState(
    LIST_COLLAPSE_AREAS.plugins,
    {},
    GROUP_IDS,
  );
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("loading");
  const scrollRef = useSidebarListScroll();

  useEffect(() => {
    const receive = (event) => {
      setEntries(event.detail?.entries || []);
      setSelectedId(event.detail?.selected || "");
      setError(event.detail?.status === "error" ? "插件列表加载失败" : "");
      setStatus(event.detail?.status || "");
    };
    window.addEventListener("eleckoi:dsh-plugins:state", receive);
    window.dispatchEvent(new Event("eleckoi:dsh-plugins:request"));
    return () => {
      window.removeEventListener("eleckoi:dsh-plugins:state", receive);
    };
  }, []);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLocaleLowerCase();
    return entries.filter((item) => !key || item.name.toLocaleLowerCase().includes(key));
  }, [entries, keyword]);

  function select(item) {
    const result = { id: item.id, kind: item.kind, opened: false, error: null };
    window.dispatchEvent(new CustomEvent("eleckoi:dsh-plugins:select", { detail: result }));
    if (result.opened) {
      setSelectedId(`${item.kind}:${item.id}`);
      onOpenDetail?.();
    }
    else onNotify("error", result.error || "插件详情暂时无法打开");
  }

  function add() {
    const result = { opened: false, error: null };
    window.dispatchEvent(new CustomEvent("eleckoi:dsh-plugins:add", { detail: result }));
    if (result.opened) {
      setSelectedId("");
      onOpenDetail?.();
    }
    else onNotify("error", result.error || "添加插件入口暂时无法打开");
  }

  return <aside className="character-list-panel plugin-list-panel" aria-label="插件列表" aria-busy={status === 'loading' || undefined}>
    <div className="preset-list-title-row">
      <h2>插件</h2>
    </div>
    <div className="search-row character-list-search preset-list-search">
      <DshSearchField value={keyword} onValueChange={setKeyword} placeholder="搜索插件…" ariaLabel="搜索插件" />
      <SidebarCreateButton title="添加插件" onClick={add} />
    </div>
    <div ref={scrollRef} className="character-list-scroll preset-list-scroll">
      {collapseStateReady ? GROUPS.map((group) => {
        const items = filtered.filter((entry) => entry.group === group.id);
        if (keyword.trim() && !items.length) return null;
        const isCollapsed = Boolean(collapsed[group.id]);
        return <section className="character-group-block preset-list-group" data-plugin-group={group.id} key={group.id}>
          <button type="button" className="character-group-row preset-group-heading" aria-expanded={!isCollapsed} onClick={() => setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))}>
            <span><span className={`character-group-toggle${isCollapsed ? " collapsed" : ""}`}><ChevronRightIcon /></span>{group.label}</span>
            <em>{items.length}</em>
          </button>
          {!isCollapsed ? <div className="character-contact-list preset-list-rows">
            {items.map((item) => <button type="button" key={`${item.kind}:${item.id}`} aria-current={selectedId === `${item.kind}:${item.id}` ? 'page' : undefined} className={`character-contact-row plugin-list-row${selectedId === `${item.kind}:${item.id}` ? " active" : ""}`} onClick={() => select(item)} title={item.name}>
              <PluginIcon item={item} />
              <span className="character-contact-copy"><strong>{item.name}</strong>{item.version ? <small className="plugin-list-version">{item.version}</small> : null}</span>
              <ChevronRightIcon />
            </button>)}
          </div> : null}
        </section>;
      }) : null}
      {status === 'loading' ? <p className="preset-list-state" role="status">正在加载插件…</p> : null}
      {status !== 'loading' && !error && keyword.trim() && !filtered.length ? <p className="preset-list-state" role="status">没有匹配的插件</p> : null}
      {error ? <p className="preset-list-state is-error" role="alert">{error}</p> : null}
    </div>
  </aside>;
}

export function PluginCenterSurface({ children }) {
  return <div className="plugin-center-surface" data-eleckoi-plugin-panel aria-label="插件中心">{children}</div>;
}
