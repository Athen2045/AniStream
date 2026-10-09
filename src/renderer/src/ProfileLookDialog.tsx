import { AlertCircle, Check, ImageUp, Lock, Move, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cachedArtworkUrl } from "../../shared/artwork";
import {
  HERO_RULES,
  clearProfileHeroImage,
  saveProfileHeroImage,
  setProfileLook,
  useProfileHeroImage,
  useProfileLook,
  usePicturePalette,
  type HeroMode,
  type PictureSource,
} from "./profile-look";
import { pictureGradient } from "./ProfileHeroBand";

interface Upload {
  name: string;
  bytes: number;
  bitmap: ImageBitmap;
  url: string;
}

/**
 * The preview is a browser object URL for the picked file or the saved JPEG data URL from the main
 * process; anything else is refused rather than placed in an image source.
 */
function previewSrc(url: string | undefined): string | undefined {
  return url && /^(blob:|data:image\/jpeg;base64,)/.test(url) ? url : undefined;
}

/**
 * Edit profile look: which picture to show (when both accounts have one) and the hero. An uploaded
 * hero is checked against `HERO_RULES`, positioned and zoomed here, then saved as a cropped JPEG
 * on this device only.
 */
export function ProfileLookDialog({
  anilistPicture,
  anilistName,
  simklPicture,
  simklName,
  banner,
  onClose,
}: {
  anilistPicture?: string;
  anilistName?: string;
  simklPicture?: string;
  simklName?: string;
  banner?: string;
  onClose: () => void;
}): React.JSX.Element {
  const saved = useProfileLook();
  const savedImage = useProfileHeroImage();
  const [picture, setPicture] = useState<PictureSource>(
    saved.picture === "simkl" && simklPicture ? "simkl" : anilistPicture ? "anilist" : "simkl",
  );
  const [hero, setHero] = useState<HeroMode>(
    saved.hero === "custom" && !savedImage ? "auto" : saved.hero,
  );
  const [upload, setUpload] = useState<Upload>();
  const [problem, setProblem] = useState<string>();
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5, zoom: 1 });
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const chosenPicture = picture === "simkl" ? simklPicture : anilistPicture;
  const palette = usePicturePalette(chosenPicture);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (upload) {
        URL.revokeObjectURL(upload.url);
        upload.bitmap.close();
      }
    },
    [upload],
  );

  async function choose(file: File): Promise<void> {
    setProblem(undefined);
    if (!(HERO_RULES.types as readonly string[]).includes(file.type))
      return setProblem(`${file.name} is not a JPG, PNG or WebP image.`);
    if (file.size > HERO_RULES.maxBytes)
      return setProblem(`${file.name} is ${megabytes(file.size)}. Choose an image up to 10 MB.`);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return setProblem(`${file.name} could not be opened as an image.`);
    }
    const { width, height } = bitmap;
    if (width < HERO_RULES.minWidth || height < HERO_RULES.minHeight) {
      bitmap.close();
      return setProblem(
        `${file.name} is ${width} × ${height}. Choose an image at least ${HERO_RULES.minWidth} × ${HERO_RULES.minHeight}.`,
      );
    }
    if (width > HERO_RULES.maxSide || height > HERO_RULES.maxSide) {
      bitmap.close();
      return setProblem(
        `${file.name} is ${width} × ${height}. Choose an image up to ${HERO_RULES.maxSide} × ${HERO_RULES.maxSide}.`,
      );
    }
    setUpload({ name: file.name, bytes: file.size, bitmap, url: URL.createObjectURL(file) });
    setCrop({ x: 0.5, y: 0.5, zoom: 1 });
    setHero("custom");
  }

  const rect = upload ? cropRect(upload.bitmap, crop) : undefined;
  // Zooming stops where the crop would fall below the minimum width, so a saved hero stays sharp.
  const maxZoom = upload ? maxCropZoom(upload.bitmap) : 1;

  function drag(event: React.PointerEvent<HTMLDivElement>): void {
    if (!upload || !rect || !frame.current) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const box = frame.current.getBoundingClientRect();
    const start = { px: event.clientX, py: event.clientY, ...crop };
    // Source pixels shown per frame pixel; the movable range is the uncropped remainder.
    const scale = rect.w / box.width;
    const move = (next: PointerEvent): void => {
      const rangeX = upload.bitmap.width - rect.w;
      const rangeY = upload.bitmap.height - rect.h;
      setCrop((current) => ({
        ...current,
        x: rangeX > 0 ? clamp(start.x - ((next.clientX - start.px) * scale) / rangeX) : 0.5,
        y: rangeY > 0 ? clamp(start.y - ((next.clientY - start.py) * scale) / rangeY) : 0.5,
      }));
    };
    const end = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setProblem(undefined);
    try {
      if (hero === "custom" && upload && rect)
        await saveProfileHeroImage(await encode(upload, rect));
      else if (hero !== "custom" && savedImage) await clearProfileHeroImage();
      setProfileLook({
        picture,
        hero: hero === "custom" && !upload && !savedImage ? "auto" : hero,
      });
      onClose();
    } catch {
      setProblem("The hero could not be saved. Try again.");
      setSaving(false);
    }
  }

  async function reset(): Promise<void> {
    if (savedImage) await clearProfileHeroImage().catch(() => undefined);
    setProfileLook({ picture: anilistPicture ? "anilist" : "simkl", hero: "auto" });
    onClose();
  }

  const customPreview = previewSrc(upload?.url ?? savedImage);
  return (
    <div
      className="look-scrim"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="look-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="look-title"
        tabIndex={-1}
        ref={dialog}
      >
        <header className="look-head">
          <h2 id="look-title">Edit profile look</h2>
          <button type="button" className="look-close" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {anilistPicture && simklPicture ? (
          <>
            <h3 className="look-label">Profile picture</h3>
            <div className="look-pictures" role="radiogroup" aria-label="Profile picture">
              {(
                [
                  ["anilist", "AniList", anilistPicture, anilistName],
                  ["simkl", "Simkl", simklPicture, simklName],
                ] as const
              ).map(([value, label, url, name]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={picture === value}
                  className="look-picture"
                  onClick={() => setPicture(value)}
                >
                  <img src={cachedArtworkUrl(url)} alt="" />
                  <span>
                    <strong>{label}</strong>
                    {name ? <small>{name}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <h3 className="look-label">Hero</h3>
        <div className="look-heroes" role="radiogroup" aria-label="Hero">
          {banner ? (
            <HeroChoice
              checked={hero === "auto"}
              title="AniList banner"
              hint="Default while AniList is connected"
              onSelect={() => setHero("auto")}
            >
              <img src={cachedArtworkUrl(banner)} alt="" />
            </HeroChoice>
          ) : null}
          <HeroChoice
            checked={hero === "mix" || (hero === "auto" && !banner)}
            title="Colours from picture"
            hint="Mixed from the picture you chose"
            onSelect={() => setHero(banner ? "mix" : "auto")}
          >
            <span className="look-mix" style={{ background: pictureGradient(palette) }} />
          </HeroChoice>
          <HeroChoice
            checked={hero === "custom"}
            title="Your image"
            hint={
              upload ? upload.name : savedImage ? "Saved on this device" : "Upload a wide image"
            }
            onSelect={() => (customPreview ? setHero("custom") : fileInput.current?.click())}
          >
            {customPreview ? (
              <img src={customPreview} alt="" />
            ) : (
              <span className="look-upload-icon">
                <ImageUp size={20} aria-hidden="true" />
              </span>
            )}
          </HeroChoice>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={HERO_RULES.types.join(",")}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void choose(file);
          }}
        />

        {hero === "custom" && upload && rect ? (
          <>
            <div
              className="look-crop"
              ref={frame}
              onPointerDown={drag}
              style={{
                backgroundImage: `url("${upload.url}")`,
                backgroundSize: `${(upload.bitmap.width / rect.w) * 100}% auto`,
                backgroundPosition: `${crop.x * 100}% ${crop.y * 100}%`,
              }}
            >
              <span className="look-crop-hint">
                <Move size={14} aria-hidden="true" />
                Drag to position
              </span>
            </div>
            <label className="look-zoom">
              Zoom
              <input
                type="range"
                min={1}
                max={maxZoom}
                disabled={maxZoom <= 1}
                step={0.01}
                value={crop.zoom}
                onChange={(event) => setCrop((c) => ({ ...c, zoom: Number(event.target.value) }))}
              />
              <span>{Math.round(crop.zoom * 100)}%</span>
            </label>
            <p className="look-ok">
              <Check size={14} aria-hidden="true" />
              <strong>Looks good</strong>
              {upload.bitmap.width} × {upload.bitmap.height} · {megabytes(upload.bytes)}
              <button
                type="button"
                className="look-link"
                onClick={() => fileInput.current?.click()}
              >
                Choose another
              </button>
            </p>
          </>
        ) : (
          <div className="look-rules" aria-label="Image requirements">
            <div>
              <strong>JPG, PNG or WebP</strong>No animated images
            </div>
            <div>
              <strong>
                At least {HERO_RULES.minWidth} × {HERO_RULES.minHeight}
              </strong>
              Smaller images look blurry
            </div>
            <div>
              <strong>
                Up to {HERO_RULES.maxSide} × {HERO_RULES.maxSide}
              </strong>
              and 10 MB
            </div>
            <div>
              <strong>Best: 2560 × 540</strong>Wide, about 4.7 : 1
            </div>
          </div>
        )}
        {problem ? (
          <p className="look-problem" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            {problem}
          </p>
        ) : null}

        <footer className="look-foot">
          <span className="look-privacy">
            <Lock size={13} aria-hidden="true" />
            Your image stays on this device. Nothing is uploaded to AniList or Simkl.
          </span>
          <button
            type="button"
            className="set-button set-button--quiet"
            onClick={() => void reset()}
          >
            Reset to default
          </button>
          <button type="button" className="set-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="set-button set-button--primary"
            disabled={saving || (hero === "custom" && !upload && !savedImage)}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function HeroChoice({
  checked,
  title,
  hint,
  onSelect,
  children,
}: {
  checked: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="look-hero"
      onClick={onSelect}
    >
      <span className="look-hero-preview">{children}</span>
      <strong>{title}</strong>
      <small>{hint}</small>
    </button>
  );
}

/** The largest zoom that keeps the cropped width at or above `HERO_RULES.minWidth`. */
export function maxCropZoom(size: { width: number; height: number }): number {
  const fitW = Math.min(size.width, size.height * HERO_RULES.aspect);
  return Math.max(1, Math.min(3, fitW / HERO_RULES.minWidth));
}

/** The source rectangle shown in the band for a focal point and zoom (1 = widest fit). */
export function cropRect(
  size: { width: number; height: number },
  crop: { x: number; y: number; zoom: number },
): { x: number; y: number; w: number; h: number } {
  const fitW = Math.min(size.width, size.height * HERO_RULES.aspect);
  const w = fitW / Math.max(1, crop.zoom);
  const h = w / HERO_RULES.aspect;
  return {
    x: (size.width - w) * clamp(crop.x),
    y: (size.height - h) * clamp(crop.y),
    w,
    h,
  };
}

async function encode(
  upload: Upload,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Uint8Array> {
  const width = Math.round(Math.min(HERO_RULES.outputWidth, rect.w));
  const height = Math.round(width / HERO_RULES.aspect);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(upload.bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  return new Uint8Array(await blob.arrayBuffer());
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
