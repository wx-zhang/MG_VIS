type TyrLogoProps = {
  adaptive?: boolean;
  className?: string;
  color?: "black" | "white";
};

const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function TyrLogo({ adaptive = false, className = "", color = "black" }: TyrLogoProps) {
  const classes = ["tyr-logo", adaptive ? "tyr-logo-adaptive" : "", className].filter(Boolean).join(" ");
  return (
    <img
      alt="TYR"
      className={classes}
      decoding="async"
      draggable={false}
      height={290}
      src={assetUrl(`brand/tyr-logo-${color}.png`)}
      width={900}
    />
  );
}

export function TyrMark({ adaptive = false, className = "" }: Omit<TyrLogoProps, "color">) {
  const classes = ["tyr-mark", adaptive ? "tyr-mark-adaptive" : "", className].filter(Boolean).join(" ");
  return (
    <img
      alt=""
      aria-hidden="true"
      className={classes}
      decoding="async"
      draggable={false}
      height={128}
      src={assetUrl("favicon-192x192.png")}
      width={128}
    />
  );
}
