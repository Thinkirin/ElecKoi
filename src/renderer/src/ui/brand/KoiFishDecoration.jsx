/* ElecKoi Koi Fish Decoration Component */

export function KoiFishDecoration({ animated = false, size = "md" }) {
  const sizes = {
    sm: 80,
    md: 120,
    lg: 160,
    xl: 200
  };

  const dimension = sizes[size];

  return (
    <svg
      className={animated ? "koi-swim" : ""}
      width={dimension}
      height={dimension * 0.6}
      viewBox="0 0 200 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="koiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--eleckoi-orange-400)" />
          <stop offset="50%" stopColor="var(--eleckoi-blue-400)" />
          <stop offset="100%" stopColor="var(--eleckoi-cyan-400)" />
        </linearGradient>
        <linearGradient id="koiAccent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--eleckoi-cyan-300)" />
          <stop offset="100%" stopColor="var(--eleckoi-blue-300)" />
        </linearGradient>
      </defs>

      {/* Koi fish body */}
      <ellipse
        cx="100"
        cy="60"
        rx="60"
        ry="30"
        fill="url(#koiGradient)"
        opacity="0.8"
      />

      {/* Tail fin */}
      <path
        d="M40 60 Q30 50, 20 55 Q25 60, 30 65 Q30 70, 20 75 Q30 80, 40 70 Z"
        fill="url(#koiAccent)"
        opacity="0.7"
      />

      {/* Dorsal fin */}
      <path
        d="M90 35 Q95 25, 100 30 Q105 25, 110 35 Z"
        fill="var(--eleckoi-orange-300)"
        opacity="0.6"
      />

      {/* Spots */}
      <circle cx="120" cy="55" r="8" fill="var(--eleckoi-orange-300)" opacity="0.5" />
      <circle cx="135" cy="65" r="6" fill="var(--eleckoi-cyan-300)" opacity="0.5" />
      <circle cx="110" cy="70" r="5" fill="var(--eleckoi-orange-200)" opacity="0.4" />

      {/* Eye */}
      <circle cx="155" cy="58" r="4" fill="var(--text)" opacity="0.8" />
      <circle cx="156" cy="57" r="1.5" fill="white" />
    </svg>
  );
}

/* CSS animations */
const koiStyles = `
@keyframes koi-swim {
  0%, 100% {
    transform: translateX(0) rotateY(0deg);
  }
  25% {
    transform: translateX(10px) rotateY(5deg);
  }
  50% {
    transform: translateX(0) rotateY(0deg);
  }
  75% {
    transform: translateX(-10px) rotateY(-5deg);
  }
}

.koi-swim {
  animation: koi-swim 4s ease-in-out infinite;
  transform-origin: center;
}
`;
