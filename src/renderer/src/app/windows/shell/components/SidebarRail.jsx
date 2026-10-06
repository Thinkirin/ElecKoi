import { Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PluginNavIcon, SettingsIcon } from "../../../../ui/icons/index.jsx";
import { Avatar } from "../../../../ui/ui/Avatar.jsx";
import logoIcon from "../../../../assets/eleckoi-app-icon.png";
import { ChatCircle, UsersThree, SlidersHorizontal, Cpu, DotsThree, X, PaintBrush, Globe, PuzzlePiece, UserCircle, GearSix } from '@phosphor-icons/react';
const PRODUCT_NAV_ICONS = { messages: ChatCircle, character: UsersThree, presets: SlidersHorizontal, model: Cpu };
const MORE_NAV_ICONS = { creatorStudio: PaintBrush, community: Globe, plugins: PuzzlePiece };
import { useAnimatedClose } from "../../../../ui/hooks/useAnimatedClose.js";

function RailIconButton({ label, active, onClick, icon, productIcon, onNotify, compact }) {
  function handleClick() {
    const reportError = (error) => {
      console.error(`Rail action failed: ${label}`, error);
      onNotify?.("error", `${label}：${error?.message || String(error)}`);
    };
    try {
      Promise.resolve(onClick?.()).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <button
      className={`rail-nav-button is-${productIcon ? "product" : "plugin"}-icon ${active ? "active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={handleClick}
    >
      <span className="rail-icon-layer base">
        <Suspense fallback={<PluginNavIcon />}>{icon}</Suspense>
      </span>
    </button>
  );
}

function RailProfileButton({ persona, active, onOpenProfile }) {
  const displayName = persona?.user_name || "你";
  const avatar = persona?.user_avatar || "";

  return (
    <div className="rail-profile-zone">
      <button
        className={`rail-user-trigger ${active ? "active" : ""}`}
        type="button"
        title="用户资料"
        aria-label="打开用户资料设置"
        onClick={onOpenProfile}
      >
        <Avatar src={avatar} name={displayName} className="rail-user-avatar" />
      </button>
    </div>
  );
}

function RailSettingsButton({ active, onOpenSettings }) {
  return (
    <button
      className={`rail-settings-trigger ${active ? "active" : ""}`}
      type="button"
      title="设置"
      aria-label="打开设置"
      aria-current={active ? "page" : undefined}
      onClick={onOpenSettings}
    >
      <SettingsIcon weight="light" />
    </button>
  );
}

export function SidebarRail({ activeSection, navigationItems = [], renderSidebarSlot, profileActive, onSectionChange, onNavigationAction, persona, onOpenProfile, onOpenSettings, compact = false, onNotify }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedMore, setSelectedMore] = useState('');
  const moreMenuRef = useRef(null);
  const pendingAction = useRef(null);
  const { closing, close } = useAnimatedClose(() => {
    setMoreOpen(false);
    setSelectedMore('');
    const action = pendingAction.current;
    pendingAction.current = null;
    if (!action) return;
    const reportError = error => {
      console.error('More navigation action failed', error);
      onNotify?.('error', error?.message || String(error));
    };
    try { Promise.resolve(action()).catch(reportError); } catch (error) { reportError(error); }
  }, 200, compact && moreOpen);
  const primaryIds = ["messages", "character", "presets", "model"];
  const primaryItems = compact ? primaryIds.flatMap(id => navigationItems.find(item => item.id === id) || []) : navigationItems;
  const moreItems = navigationItems.filter(item => !primaryItems.some(primary => primary.id === item.id));
  const activeIndex = moreOpen ? 4 : Math.max(0, primaryIds.includes(activeSection) ? primaryIds.indexOf(activeSection) : 4);
  const activate = item => item.action ? onNavigationAction?.(item.id) : onSectionChange(item.id);

  useEffect(() => {
    if (!compact) setMoreOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!compact || !moreOpen) return undefined;
    const previousFocus = document.activeElement;
    moreMenuRef.current?.querySelector('button')?.focus();
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const buttons = Array.from(moreMenuRef.current?.querySelectorAll('button:not(:disabled)') || []);
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [compact, moreOpen, close]);
  const renderItem = ({ id, label, action, productIcon }) => (
    <RailIconButton
      key={id}
      label={label}
      active={!action && activeSection === id}
      onClick={() => action ? onNavigationAction?.(id) : onSectionChange(id)}
      icon={compact && PRODUCT_NAV_ICONS[id] ? (() => { const Icon = PRODUCT_NAV_ICONS[id]; return <Icon size={22} weight={activeSection === id ? 'fill' : 'regular'} />; })() : renderSidebarSlot?.("sidebar.panellist", { size: 22, active: !action && activeSection === id }, { only: id }) || <PluginNavIcon />}
      compact={compact}
      productIcon={productIcon}
      onNotify={onNotify}
    />
  );

  function runMore(id, action) {
    if (closing || pendingAction.current) return;
    pendingAction.current = action;
    setSelectedMore(id);
    close();
  }

  return (
    <aside className="qq-rail" aria-label="侧边功能栏">
      <span className="rail-brand-seat" aria-hidden="true">
        {renderSidebarSlot?.("sidebar.brand.mark", { size: 30, content: <img src={logoIcon} alt="" draggable="false" /> }) || <img src={logoIcon} alt="" draggable="false" />}
        {renderSidebarSlot?.("sidebar.toggle.badge", {})}
      </span>
      <div className="rail-nav-group">
        {compact ? <span className="mobile-rail-indicator" aria-hidden="true" style={{ '--nav-index': activeIndex }} /> : null}
        {primaryItems.map(renderItem)}
        {compact ? <button type="button" className={`rail-nav-button mobile-more-trigger${activeIndex === 4 ? " active" : ""}`} aria-label="更多功能" aria-expanded={moreOpen} onClick={() => moreOpen ? close() : setMoreOpen(true)}><span className="rail-icon-layer base"><DotsThree size={24} weight="bold" /></span></button> : null}
      </div>
      {!compact ? <div className="rail-bottom-zone">
        <RailProfileButton persona={persona} active={profileActive} onOpenProfile={onOpenProfile} />
        {renderSidebarSlot?.("sidebar.settings", {
          wide: false,
          content: <RailSettingsButton active={activeSection === "settings" && !profileActive} onOpenSettings={onOpenSettings} />,
        }) || <RailSettingsButton active={activeSection === "settings" && !profileActive} onOpenSettings={onOpenSettings} />}
      </div> : null}
      {compact && moreOpen ? createPortal(<div className={`mobile-more-backdrop${closing ? " closing" : ""}`} onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
        <section ref={moreMenuRef} className="mobile-more-menu" role="dialog" aria-modal="true" aria-label="更多功能">
          <header><strong>更多</strong><button type="button" aria-label="关闭更多功能" onClick={close}><X size={18} /></button></header>
          <div className="mobile-more-grid">
            {moreItems.map(item => {
              const Icon = MORE_NAV_ICONS[item.id];
              return <button key={item.id} type="button" data-action={item.id} className={selectedMore === item.id ? 'is-selected' : undefined} disabled={closing} onClick={() => runMore(item.id, () => activate(item))}>
                <span className="mobile-more-icon"><Suspense fallback={<PluginNavIcon />}>{Icon ? <Icon size={22} /> : renderSidebarSlot?.("sidebar.panellist", { size: 22, active: activeSection === item.id }, { only: item.id }) || <PluginNavIcon />}</Suspense></span><span>{item.label}</span>
              </button>;
            })}
            <button type="button" data-action="profile" className={selectedMore === 'profile' ? 'is-selected' : undefined} disabled={closing} onClick={() => runMore('profile', onOpenProfile)}><span className="mobile-more-icon">{persona?.user_avatar ? <Avatar src={persona.user_avatar} name={persona.user_name || '你'} /> : <UserCircle size={22} />}</span><span>用户资料</span></button>
            <button type="button" data-action="settings" className={selectedMore === 'settings' ? 'is-selected' : undefined} disabled={closing} onClick={() => runMore('settings', onOpenSettings)}><span className="mobile-more-icon"><GearSix size={22} /></span><span>设置</span></button>
          </div>
        </section>
      </div>, document.body) : null}
    </aside>
  );
}
