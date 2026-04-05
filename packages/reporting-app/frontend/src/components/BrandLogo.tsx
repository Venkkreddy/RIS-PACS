import { brand } from "../theme";

/**
 * TD|ai branded logo — uses the official PNG logo.
 * T = Teal (#00B4A6), D = Navy (#1A2B56), | = Gray (#808080), ai = Red (#E03C31)
 */
export function BrandLogo({ compact = false, showPoweredBy, variant = "color" }: { compact?: boolean; showPoweredBy?: boolean; variant?: "color" | "white" }) {
  const shouldShowPoweredBy = showPoweredBy ?? !compact;
  const isWhite = variant === "white";
  const height = compact ? "h-8" : "h-10";
  const maxWidth = compact ? "max-w-[140px]" : "max-w-[180px]";

  return (
    <div className="inline-flex flex-col items-start justify-center gap-1 leading-none">
      <img
        src="/tdai-logo.png"
        alt="TD|ai"
        className={`${height} ${maxWidth} block w-auto select-none object-contain ${isWhite ? "brightness-0 invert" : ""}`}
        draggable={false}
        loading="eager"
        decoding="async"
      />
      {shouldShowPoweredBy ? (
        <span className={`text-[10px] font-medium tracking-[0.08em] ${isWhite ? "text-white/60" : "text-tdai-gray-400"}`}>
          {brand.poweredBy}
        </span>
      ) : null}
    </div>
  );
}
