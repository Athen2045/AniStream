import { useState } from "react";
import type { PicturePalette } from "../../shared/contracts";
import { cachedArtworkUrl } from "../../shared/artwork";
import { chooseHero, useProfileHeroImage, useProfileLook, usePicturePalette } from "./profile-look";

/** Three soft colour pools from the picture; the brand greens until the colours arrive. */
export function pictureGradient(palette: PicturePalette | undefined): string {
  const [a, b, c] = palette ?? ["#2a835f", "#1f5f73", "#369d73"];
  return [
    `radial-gradient(ellipse 45% 120% at 12% 10%, ${a}, transparent 70%)`,
    `radial-gradient(ellipse 40% 110% at 55% 0%, ${b}, transparent 70%)`,
    `radial-gradient(ellipse 45% 120% at 92% 30%, ${c}, transparent 70%)`,
    "#0b0c0b",
  ].join(", ");
}

/**
 * The profile band (shared 1900×400 geometry): the viewer's own image, the AniList banner, or a
 * gradient mixed from the chosen picture, per Edit look.
 */
export function ProfileHeroBand({
  banner,
  pictureUrl,
}: {
  banner?: string;
  pictureUrl?: string;
}): React.JSX.Element {
  const look = useProfileLook();
  const custom = useProfileHeroImage();
  const [failed, setFailed] = useState<string>();
  const hero = chooseHero(
    look.hero,
    custom,
    banner && banner !== failed ? banner : undefined,
    pictureUrl,
  );
  const palette = usePicturePalette(hero.kind === "mix" ? pictureUrl : undefined);

  if (hero.kind === "image")
    return (
      <div className="title-band" aria-hidden="true">
        <img
          className="title-band-art profile-band-art"
          src={hero.custom ? hero.url : cachedArtworkUrl(hero.url)}
          alt=""
          decoding="async"
          onError={() => setFailed(hero.url)}
        />
      </div>
    );
  return (
    <div
      className="title-band profile-band-mix"
      aria-hidden="true"
      style={{ background: pictureGradient(palette) }}
    />
  );
}
