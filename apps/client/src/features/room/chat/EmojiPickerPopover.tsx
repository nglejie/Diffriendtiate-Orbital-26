import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";

type EmojiPickerPopoverProps = {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (emoji: string) => void;
};

export function EmojiPickerPopover({ anchorRef, onClose, onPick }: EmojiPickerPopoverProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: 12, maxHeight: 390, top: 12, width: 340 });

  useEffect(() => {
    function handleOutsideInteraction(event: MouseEvent | PointerEvent) {
      const target = event.target as Node;
      if (!pickerRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handleOutsideInteraction, true);
    return () => document.removeEventListener("pointerdown", handleOutsideInteraction, true);
  }, [anchorRef, onClose]);

  useEffect(() => {
    function updatePosition() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;

      const width = Math.min(340, Math.max(280, window.innerWidth - 24));
      const height = Math.min(390, Math.max(280, window.innerHeight - 24));
      const left = Math.min(Math.max(12, anchor.left), Math.max(12, window.innerWidth - width - 12));
      const topAbove = anchor.top - height - 10;
      const topBelow = anchor.bottom + 10;
      const top = topAbove >= 12 ? topAbove : Math.min(topBelow, Math.max(12, window.innerHeight - height - 12));

      setPosition({ left, maxHeight: height, top, width });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  return createPortal(
    <div
      className="discord-emoji-picker portal"
      onMouseDown={(event) => event.stopPropagation()}
      ref={pickerRef}
      style={position}
    >
      <EmojiPickerReact
        emojiStyle={EmojiStyle.NATIVE}
        height="100%"
        lazyLoadEmojis
        onEmojiClick={(emojiData) => onPick(emojiData.emoji)}
        previewConfig={{ showPreview: false }}
        searchPlaceHolder="Search"
        theme={Theme.AUTO}
        width="100%"
      />
    </div>,
    document.body,
  );
}
