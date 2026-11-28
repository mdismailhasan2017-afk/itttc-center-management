export function EmblemLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="ITTC Center Emblem"
      className="shrink-0"
    >
      <circle cx="32" cy="32" r="30" fill="#0F766E" stroke="#CCFBF1" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="24" fill="#FFFFFF" />
      <circle cx="32" cy="32" r="20" fill="#F0FDFA" stroke="#0D9488" strokeWidth="1.5" />
      <path
        d="M20 38L26 24H30L36 38M22.5 33.5H33.5"
        stroke="#0F766E"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M38 24H45M41.5 24V38"
        stroke="#134E4A"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M17 44C21 48 26.2 50 32 50C37.8 50 43 48 47 44"
        stroke="#0F766E"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
