/* ElecKoi Logo Component */

export function ElecKoiLogo({ size = "md", showText = true, animated = false }) {
  const sizes = {
    sm: 24,
    md: 32,
    lg: 48,
    xl: 64
  };

  const dimension = sizes[size];

  return (
    <div className={`eleckoi-logo ${animated ? 'eleckoi-logo--animated' : ''}`}>
      <svg
        width={dimension}
        height={dimension}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="ElecKoi"
      >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--eleckoi-blue-500)" />
            <stop offset="50%" stopColor="var(--eleckoi-blue-600)" />
            <stop offset="100%" stopColor="var(--eleckoi-cyan-400)" />
          </linearGradient>
        </defs>

        {/* Simplified Koi fish / whale tail shape */}
        <path
          d="M50 20 C30 20, 20 30, 20 50 C20 70, 30 80, 50 80 C70 80, 80 70, 80 50 C80 30, 70 20, 50 20 Z M35 45 C35 40, 40 35, 45 35 C50 35, 55 40, 55 45 C55 50, 50 55, 45 55 C40 55, 35 50, 35 45 Z"
          fill="url(#logoGradient)"
          opacity="0.9"
        />

        {/* Tail accent */}
        <path
          d="M75 50 Q85 45, 90 50 Q85 55, 75 50 Z"
          fill="var(--eleckoi-cyan-300)"
          opacity="0.7"
        />
      </svg>

      {showText && (
        <span className="eleckoi-logo-text">电子爱</span>
      )}
    </div>
  );
}

/* CSS for the logo */
const logoStyles = `
.eleckoi-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.eleckoi-logo-text {
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--text);
  background: var(--eleckoi-gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.eleckoi-logo--animated svg {
  animation: logo-float 3s ease-in-out infinite;
}

@keyframes logo-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

:root[data-theme="dark"] .eleckoi-logo-text {
  background: linear-gradient(135deg, var(--eleckoi-blue-300) 0%, var(--eleckoi-cyan-300) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
`;
