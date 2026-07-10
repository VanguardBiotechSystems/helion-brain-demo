/** Iconos SVG inline (sin dependencias). Todos heredan currentColor. */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number | undefined) {
  return {
    width: size ?? 18,
    height: size ?? 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function PowerIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3v8" />
      <path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
    </svg>
  );
}

export function MicIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function MicOffIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function StopIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export function RefreshIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

export function TrashIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export function CaptionsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 12H7v3h3" />
      <path d="M17 12h-3v3h3" />
    </svg>
  );
}

export function WrenchIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L4 17a2 2 0 0 0 3 3l4.7-4.7a4.5 4.5 0 0 0 6-6L14.5 12 12 9.5z" />
    </svg>
  );
}

export function LogoutIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function SendIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

export function RobotIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1" />
      <circle cx="9.5" cy="13" r="1" />
      <circle cx="14.5" cy="13" r="1" />
      <path d="M9 16.5h6" />
    </svg>
  );
}

export function CloseIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function BrainIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3" />
      <path d="M12 4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3" />
      <path d="M9 8H7.5A2.5 2.5 0 0 0 5 10.5v0A2.5 2.5 0 0 0 7.5 13H9" />
      <path d="M15 8h1.5A2.5 2.5 0 0 1 19 10.5v0a2.5 2.5 0 0 1-2.5 2.5H15" />
      <path d="M12 8h0" />
    </svg>
  );
}

export function HandIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M8 12l-1.8-1.8a1.4 1.4 0 0 0-2 2L8 16.5A5.5 5.5 0 0 0 12.5 21h.5a5 5 0 0 0 4-2l0 0" />
    </svg>
  );
}

export function AlertIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r="0.4" fill="currentColor" />
    </svg>
  );
}
