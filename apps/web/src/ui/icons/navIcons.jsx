export function MessageNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="nav-fill message-fill" d="M6.2 5.1h11.6a3.2 3.2 0 0 1 3.2 3.2v5.2a3.2 3.2 0 0 1-3.2 3.2h-5.5L7.1 20v-3.3h-.9A3.2 3.2 0 0 1 3 13.5V8.3a3.2 3.2 0 0 1 3.2-3.2Z" />
      <path d="M6.2 5.1h11.6a3.2 3.2 0 0 1 3.2 3.2v5.2a3.2 3.2 0 0 1-3.2 3.2h-5.5L7.1 20v-3.3h-.9A3.2 3.2 0 0 1 3 13.5V8.3a3.2 3.2 0 0 1 3.2-3.2Z" />
      <circle className="nav-cutout" cx="9.5" cy="10.9" r="1.15" />
      <circle className="nav-cutout" cx="14.5" cy="10.9" r="1.15" />
    </svg>
  );
}

export function PersonNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle className="nav-fill" cx="11.3" cy="7.7" r="4.2" />
      <path className="nav-fill" d="M4.1 20.2c.72-4.25 3.15-6.35 7.2-6.35 2.3 0 4.15.68 5.42 2.04l-1.3 4.31H4.1Z" />
      <path d="M11.3 11.9a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z" />
      <path d="M4.1 20.2c.72-4.25 3.15-6.35 7.2-6.35 2.3 0 4.15.68 5.42 2.04" />
      <path d="M17.6 8.1h3.2M17.6 11h2.35" />
    </svg>
  );
}

export function PresetNavIcon() {
  return (
    <svg className="preset-nav-agent" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.69 5.7a8 8 0 0 1 4.28 7.8M16 19.73a8 8 0 0 1-8 0M4.03 13.5a8 8 0 0 1 4.28-7.8" />
      <circle cx="12" cy="4.8" r="2.55" />
      <circle cx="5.25" cy="17.1" r="2.55" />
      <circle cx="18.75" cy="17.1" r="2.55" />
    </svg>
  );
}

export function ModelNavIcon() {
  return (
    <svg className="model-nav-cube" viewBox="0 0 24 24" aria-hidden="true">
      <path className="nav-fill model-cube-face" d="M12 2.9 20.2 7.35 12 11.9 3.8 7.35Z" />
      <path className="nav-fill model-cube-face" d="M3.8 7.35 12 11.9v9.2l-8.2-4.45Z" />
      <path className="nav-fill model-cube-face" d="M12 11.9 20.2 7.35v9.3L12 21.1Z" />
      <path d="M12 2.9 20.2 7.35v9.3L12 21.1 3.8 16.65v-9.3Z" />
      <path className="model-cube-inner" d="M3.8 7.35 12 11.9l8.2-4.55M12 11.9v9.2" />
    </svg>
  );
}

export function PluginNavIcon() {
  return <svg className="plugin-nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942" stroke="currentColor" />
    <path d="M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037" stroke="currentColor" />
    <path d="M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798" stroke="currentColor" />
    <path d="M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723" stroke="currentColor" />
  </svg>;
}

export function CreatorStudioNavIcon() {
  return (
    <svg className="creator-studio-nav" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="16" rx="4.75" />
      <path
        className="creator-studio-star"
        d="M240 128a15.79 15.79 0 0 1-10.5 15l-63.44 23.07L143 229.5a16 16 0 0 1-30 0l-23.06-63.44L26.5 143a16 16 0 0 1 0-30l63.44-23.06L113 26.5a16 16 0 0 1 30 0l23.06 63.44L229.5 113A15.79 15.79 0 0 1 240 128Z"
        transform="translate(8 8) scale(.03125)"
      />
    </svg>
  );
}

export function CommunityNavIcon() {
  return (
    <svg className="community-nav-group" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.15" />
      <path d="M3.4 19.4c.55-3.72 2.42-5.58 5.6-5.58s5.05 1.86 5.6 5.58" />
      <path d="M14.6 5.45a3 3 0 0 1 0 5.1" />
      <path d="M16.15 13.7c2.55.42 4 2.32 4.45 5.7" />
    </svg>
  );
}
