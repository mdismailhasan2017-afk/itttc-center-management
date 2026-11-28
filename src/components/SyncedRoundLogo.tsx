interface SyncedRoundLogoProps {
  logoDataUrl?: string;
  size?: number;
  alt?: string;
  fallbackText?: string;
}

export function SyncedRoundLogo({
  logoDataUrl,
  size = 40,
  alt = 'ITTC Logo',
  fallbackText = 'IT',
}: SyncedRoundLogoProps) {
  const fontSize = Math.max(10, Math.round(size * 0.31));

  return (
    <div
      style={{ width: size, height: size }}
      className="relative rounded-full bg-white text-[#062823] flex items-center justify-center shrink-0 overflow-hidden border-2 border-[var(--accent)] shadow-[0_0_16px_var(--accent-soft)]"
    >
      {logoDataUrl ? (
        <img
          src={logoDataUrl}
          alt={alt}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          style={{ fontSize }}
          className="font-display font-extrabold leading-none tracking-tight select-none"
        >
          {fallbackText}
        </span>
      )}
    </div>
  );
}
