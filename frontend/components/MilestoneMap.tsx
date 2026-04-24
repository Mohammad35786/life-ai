"use client";

import React from "react";
import { type MilestoneResponse } from "../lib/adaptive";

const POSITIONS: Array<"left" | "right"> = ["right", "left", "right", "left", "right", "left", "right", "left"];

function msIcon(status: string, num: number) {
  if (status === "completed") return "✓";
  if (status === "locked") return "🔒";
  return String(num);
}

interface MilestoneMapProps {
  milestones: MilestoneResponse[];
  planColor: string;
  onMilestoneClick: (ms: MilestoneResponse) => void;
}

export function MilestoneMap({ milestones, planColor, onMilestoneClick }: MilestoneMapProps) {
  return (
    <div className="mpath">
      {milestones.map((ms, i) => {
        const pos = POSITIONS[i % POSITIONS.length];
        const isCompleted = ms.status === "completed";
        const isActive = ms.status === "active";
        const isLocked = ms.status === "locked";
        const showConnector = i < milestones.length - 1;
        const connectorDone = isCompleted;

        const nodeStyle = isCompleted
          ? { background: planColor, color: "#fff", border: "none" }
          : isActive
          ? { background: "#fff", border: `2.5px solid ${planColor}`, color: planColor }
          : { background: "var(--gray-100)", border: "1.5px solid var(--gray-200)", color: "var(--text-tertiary)" };

        return (
          <div key={ms.id} className="mpathNodeWrap">
            <div className={`mpathRow ${pos}`}>
              <div className="mpathNodeInner">
                <button
                  className={`mpathNode ${isCompleted ? "done" : isActive ? "active" : "locked"}`}
                  style={nodeStyle}
                  onClick={() => onMilestoneClick(ms)}
                  title={ms.title}
                  aria-label={ms.title}
                >
                  {msIcon(ms.status, i + 1)}
                </button>
                <div className={`mpathLabel ${ms.status}`}>
                  {ms.title.length > 10 ? ms.title.slice(0, 10) + "…" : ms.title}
                </div>
              </div>
            </div>

            {showConnector && (
              <div className={`mpathConnector ${connectorDone ? "done" : ""}`}
                style={connectorDone ? { background: planColor } : {}}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
