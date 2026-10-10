import { Suspense } from "react";
import { PluginNavIcon, SettingsIcon } from "../../../../ui/icons/index.jsx";
import { Avatar } from "../../../../ui/ui/Avatar.jsx";
import logoIcon from "../../../../assets/eleckoi-app-icon.png";

function RailIconButton({ label, active, onClick, icon, productIcon }) {
  function handleClick() {
    Promise.resolve(onClick?.()).catch((error) => {
      console.error(`Rail action failed: ${label}`, error);
    });
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
      <span className="rail-icon-layer active-fill" aria-hidden="true">
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

export function SidebarRail({ activeSection, navigationItems = [], renderSidebarSlot, profileActive, onSectionChange, onNavigationAction, persona, onOpenProfile, onOpenSettings }) {
  const renderItem = ({ id, label, action, productIcon }) => (
    <RailIconButton
      key={id}
      label={label}
      active={!action && activeSection === id}
      onClick={() => action ? onNavigationAction?.(id) : onSectionChange(id)}
      icon={renderSidebarSlot?.("sidebar.panellist", { size: 24, active: !action && activeSection === id }, { only: id }) || <PluginNavIcon />}
      productIcon={productIcon}
    />
  );
  return (
    <aside className="qq-rail" aria-label="侧边功能栏">
      <span className="rail-brand-seat" aria-hidden="true">
        {renderSidebarSlot?.("sidebar.brand.mark", { size: 30, content: <img src={logoIcon} alt="" draggable="false" /> }) || <img src={logoIcon} alt="" draggable="false" />}
        {renderSidebarSlot?.("sidebar.toggle.badge", {})}
      </span>
      <div className="rail-nav-group">
        {navigationItems.map(renderItem)}
      </div>
      <div className="rail-bottom-zone">
        <RailProfileButton persona={persona} active={profileActive} onOpenProfile={onOpenProfile} />
        {renderSidebarSlot?.("sidebar.settings", {
          wide: false,
          content: <RailSettingsButton active={activeSection === "settings" && !profileActive} onOpenSettings={onOpenSettings} />,
        }) || <RailSettingsButton active={activeSection === "settings" && !profileActive} onOpenSettings={onOpenSettings} />}
      </div>
    </aside>
  );
}
