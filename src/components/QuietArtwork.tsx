import { useId } from "react";
import "./QuietArtwork.css";

export function QuietArtwork({ className }: { className?: string }) {
  const uid = useId();
  const bandId = "qa-band-" + uid;
  const bandMidId = "qa-band-mid-" + uid;
  const bandCoreId = "qa-band-core-" + uid;
  const sheenId = "qa-sheen-" + uid;
  const diskId = "qa-disk-" + uid;
  const inkDiskId = "qa-ink-disk-" + uid;
  const groundId = "qa-ground-" + uid;
  return (
    <div
      className={"quiet-art" + (className ? " " + className : "")}
      aria-hidden="true"
    >
      <svg
        className="quiet-art-svg"
        viewBox="0 0 560 560"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient id={bandId} x1="120" y1="470" x2="424" y2="86" gradientUnits="userSpaceOnUse">
            <stop className="quiet-art-band-a" offset="0" />
            <stop className="quiet-art-band-b" offset="0.5" />
            <stop className="quiet-art-band-c" offset="0.78" />
            <stop className="quiet-art-band-fade" offset="1" />
          </linearGradient>
          <linearGradient id={bandMidId} x1="132" y1="452" x2="412" y2="102" gradientUnits="userSpaceOnUse">
            <stop className="quiet-art-band-a" offset="0" />
            <stop className="quiet-art-band-b" offset="0.52" />
            <stop className="quiet-art-band-fade" offset="0.86" />
          </linearGradient>
          <linearGradient id={bandCoreId} x1="150" y1="430" x2="396" y2="128" gradientUnits="userSpaceOnUse">
            <stop className="quiet-art-band-b" offset="0" />
            <stop className="quiet-art-band-c" offset="0.5" />
            <stop className="quiet-art-band-fade" offset="0.74" />
          </linearGradient>
          <linearGradient id={sheenId} x1="170" y1="420" x2="380" y2="120" gradientUnits="userSpaceOnUse">
            <stop className="quiet-art-sheen-a" offset="0" />
            <stop className="quiet-art-sheen-b" offset="0.85" />
          </linearGradient>
          <linearGradient id={diskId} x1="222" y1="270" x2="290" y2="310" gradientUnits="userSpaceOnUse">
            <stop className="quiet-art-disk-b" offset="0" />
            <stop className="quiet-art-disk-a" offset="0.2" />
            <stop className="quiet-art-disk-a" offset="0.44" />
            <stop className="quiet-art-disk-b" offset="0.7" />
            <stop className="quiet-art-disk-a" offset="0.87" />
            <stop className="quiet-art-disk-c" offset="1" />
          </linearGradient>
          <radialGradient id={inkDiskId} cx="0.36" cy="0.3" r="0.85">
            <stop className="quiet-art-disk-a" offset="0" />
            <stop className="quiet-art-disk-b" offset="0.62" />
            <stop className="quiet-art-disk-c" offset="1" />
          </radialGradient>
          <radialGradient id={groundId} cx="0.5" cy="0.5" r="0.5">
            <stop className="quiet-art-ground-a" offset="0" />
            <stop className="quiet-art-ground-b" offset="1" />
          </radialGradient>
        </defs>
        <ellipse className="quiet-art-ground" cx="280" cy="524" rx="196" ry="15" fill={"url(#" + groundId + ")"} />
        <path className="quiet-art-hairline quiet-art-ink-only" d="M 26 398 Q 292 452 534 228" />
        <g className="quiet-art-bands" transform="rotate(14 280 278)">
          <ellipse
            className="quiet-art-band quiet-art-band-soft"
            cx="280"
            cy="278"
            rx="188"
            ry="234"
            opacity={0.55}
            stroke={"url(#" + bandId + ")"}
          />
          <ellipse
            className="quiet-art-band quiet-art-band-mid"
            cx="280"
            cy="278"
            rx="183"
            ry="228"
            opacity={0.72}
            stroke={"url(#" + bandMidId + ")"}
          />
          <ellipse
            className="quiet-art-sheen"
            cx="280"
            cy="278"
            rx="183"
            ry="228"
            pathLength={100}
            strokeDasharray="34 66"
            strokeDashoffset={-64}
            opacity={0.85}
            stroke={"url(#" + sheenId + ")"}
          />
          <ellipse
            className="quiet-art-band quiet-art-band-core"
            cx="280"
            cy="278"
            rx="177"
            ry="222"
            opacity={0.85}
            stroke={"url(#" + bandCoreId + ")"}
          />
          <ellipse className="quiet-art-rim" cx="280" cy="278" rx="162" ry="208" />
          <ellipse className="quiet-art-edge" cx="280" cy="278" rx="188" ry="234" />
        </g>
        <circle className="quiet-art-disk quiet-art-porcelain-only" cx="255" cy="292" r="40" fill={"url(#" + diskId + ")"} />
        <circle className="quiet-art-disk quiet-art-ink-only" cx="255" cy="292" r="30" fill={"url(#" + inkDiskId + ")"} />
        <path className="quiet-art-hairline quiet-art-porcelain-only" d="M 26 386 Q 292 330 534 202" />
      </svg>
    </div>
  );
}
