// LibreNotebook brand mark — a notebook + radio-wave glyph riffing on
// NotebookLM's logo without copying it.

interface LogoProps {
  size?: number;
  class?: string;
}

export function Logo({ size = 28, class: cls = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
      aria-hidden="true"
    >
      {/* notebook spine */}
      <rect x="6" y="4" width="20" height="24" rx="3" />
      <line x1="10" y1="4" x2="10" y2="28" />
      {/* concentric arcs */}
      <path d="M14 16 q3 -3 6 0" />
      <path d="M13 19 q4 -4 8 0" />
      <circle cx="17" cy="22" r="1" fill="currentColor" />
    </svg>
  );
}
