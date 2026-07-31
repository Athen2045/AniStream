import { useState } from "react";

/**
 * Cover-art `<img>` with lazy loading and a one-time fallback-URL retry, matching the
 * pattern already proven by CatalogView's LatestMangaCover. Falls back to a plain text
 * badge if both the primary and fallback URLs fail (or neither is provided).
 */
export function CoverImage({
  src,
  fallbackSrc,
  alt = "",
  title,
  className,
}: {
  src?: string;
  fallbackSrc?: string;
  alt?: string;
  title?: string;
  className?: string;
}): React.JSX.Element {
  const [source, setSource] = useState(src);
  // Adjust state directly during render when `src` changes, rather than in an effect
  // (see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [trackedSrc, setTrackedSrc] = useState(src);
  if (trackedSrc !== src) {
    setTrackedSrc(src);
    setSource(src);
  }

  if (!source) {
    return (
      <span className={className ? `${className} cover-image-fallback` : "cover-image-fallback"}>
        {title ?? ""}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={source}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setSource((current) => (current !== fallbackSrc ? fallbackSrc : undefined));
      }}
    />
  );
}
