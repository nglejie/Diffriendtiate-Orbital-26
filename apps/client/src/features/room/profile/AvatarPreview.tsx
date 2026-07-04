import type { CSSProperties } from "react";
import {
  LimeetsAvatarPreset,
  getGatherAvatarFrameIndex,
  normalizeLimeetsAvatarPreset,
} from "./avatarPresets.ts";

type AvatarPreviewProps = {
  avatar?: LimeetsAvatarPreset | null;
  className?: string;
  direction?: string;
  frame?: number;
  moving?: boolean;
  size?: "tiny" | "small" | "medium" | "profile" | "large" | "world";
};

const RENDER_SIZE_BY_CLASS = {
  tiny: 28,
  small: 42,
  medium: 58,
  profile: 72,
  large: 96,
  world: 46,
};

const GATHER_AVATAR_FRAME_COLUMNS = 16;
const AVATAR_CELL_ASPECT_RATIO = 2;
const AVATAR_CELL_VERTICAL_OFFSET = 0.6;

export function AvatarPreview({
  avatar,
  className = "",
  direction = "down",
  frame = 1,
  moving = false,
  size = "medium",
}: AvatarPreviewProps) {
  const preset = normalizeLimeetsAvatarPreset(avatar);
  const frameIndex = getGatherAvatarFrameIndex(direction, moving, frame);
  const frameWidth = RENDER_SIZE_BY_CLASS[size] || RENDER_SIZE_BY_CLASS.medium;
  const frameHeight = Math.round(frameWidth * 1.24);
  const sheetHeight = frameWidth * AVATAR_CELL_ASPECT_RATIO;
  const sheetY = -Math.round(frameWidth * AVATAR_CELL_VERTICAL_OFFSET);

  return (
    <span
      aria-label={`${preset.label} avatar`}
      className={`limeets-avatar-stack ${size} ${className}`.trim()}
      role="img"
      style={
        {
          "--limeets-avatar-frame-height": `${frameHeight}px`,
          "--limeets-avatar-render-size": `${frameWidth}px`,
        } as CSSProperties
      }
    >
      {preset.layers.map((layer, index) => (
        <span
          aria-hidden="true"
          className="limeets-avatar-layer"
          key={`${layer.slot}-${layer.label}-${index}`}
          style={{
            backgroundImage: `url("${layer.src}")`,
            backgroundPosition: `${-frameIndex * frameWidth}px ${sheetY}px`,
            backgroundSize: `${frameWidth * GATHER_AVATAR_FRAME_COLUMNS}px ${sheetHeight}px`,
          }}
        />
      ))}
    </span>
  );
}
