"use client";

import React, { useEffect } from "react";
import { OverlayItem } from "./LayoutContext";

export type { OverlayItem };

interface OverlayLayerProps {
  overlays: OverlayItem[];
  onDismiss: (id?: string) => void;
}

export function OverlayLayer({ overlays, onDismiss }: OverlayLayerProps) {
  // Close top overlay on Escape
  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && overlays.length > 0) {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [overlays, onDismiss]);

  if (overlays.length === 0) return null;

  return (
    <div className="overlayLayer">
      {overlays.map((item) => (
        <div key={item.id} className="overlayBackdrop" onClick={() => item.dismissible !== false && onDismiss(item.id)}>
          <div className="overlayContent" onClick={(e) => e.stopPropagation()}>
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}
