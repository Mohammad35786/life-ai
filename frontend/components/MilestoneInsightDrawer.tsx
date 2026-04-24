"use client";

import React, { useEffect, useMemo } from "react";
import { IconClose } from "./icons";
import type { MilestoneInsightResponse, MilestoneResponse } from "../lib/adaptive";

type DrawerState = {
  open: boolean;
  milestone: MilestoneResponse | null;
  loading: boolean;
  error: string | null;
  insight: MilestoneInsightResponse | null;
  onRetry?: () => void;
};

function renderValue(value: any): React.ReactNode {
  if (value == null) return null;
  if (typeof value === "string") return <p className="milestoneInsightDrawerText">{value}</p>;
  if (typeof value === "number" || typeof value === "boolean") return <p className="milestoneInsightDrawerText">{String(value)}</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    // Detect array-of-objects with common keys (step/instruction, type/title/description)
    const isStepList = value.every((i) => typeof i === "object" && i !== null && "step" in i && "instruction" in i);
    const isResourceList = value.every((i) => typeof i === "object" && i !== null && "type" in i && "title" in i);
    if (isStepList) {
      return (
        <ol className="milestoneInsightDrawerStepList">
          {value.map((item: any, idx: number) => (
            <li key={idx} className="milestoneInsightDrawerStepItem">
              <span className="milestoneInsightDrawerStepNum">{item.step}</span>
              <span className="milestoneInsightDrawerStepText">{item.instruction}</span>
            </li>
          ))}
        </ol>
      );
    }
    if (isResourceList) {
      return (
        <ul className="milestoneInsightDrawerResourceList">
          {value.map((item: any, idx: number) => (
            <li key={idx} className="milestoneInsightDrawerResourceItem">
              <span className="milestoneInsightDrawerResourceType">{item.type}</span>
              <span className="milestoneInsightDrawerResourceTitle">{item.title}</span>
              {item.description && <span className="milestoneInsightDrawerResourceDesc">{item.description}</span>}
            </li>
          ))}
        </ul>
      );
    }
    // Generic array: strings or mixed
    return (
      <ul className="milestoneInsightDrawerList">
        {value.map((item, idx) => (
          <li key={idx} className="milestoneInsightDrawerListItem">
            {typeof item === "string" ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return (
      <pre className="milestoneInsightDrawerPre">{JSON.stringify(value, null, 2)}</pre>
    );
  }
  return <p className="milestoneInsightDrawerText">{String(value)}</p>;
}

function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="milestoneInsightDrawerSkeleton">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="milestoneInsightDrawerSkeletonLine"
          style={{ width: i === lines - 1 ? "60%" : undefined }}
        />
      ))}
    </div>
  );
}

export function MilestoneInsightDrawer({ open, milestone, loading, error, insight, onRetry, onClose }: DrawerState & { onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const title = useMemo(() => {
    if (!milestone) return "Milestone";
    return milestone.title || "Milestone";
  }, [milestone]);

  if (!open) return null;

  return (
    <>
      <div className="milestoneInsightDrawerBackdrop" onClick={onClose} />
      <div
        className="milestoneInsightDrawerPanel"
        role="dialog"
        aria-modal="true"
        aria-label="Milestone insight"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="milestoneInsightDrawerHeader">
          <h2 className="milestoneInsightDrawerTitle">{title}</h2>
          <button
            className="milestoneInsightDrawerCloseBtn"
            type="button"
            onClick={onClose}
            aria-label="Close milestone insight"
          >
            <IconClose />
          </button>
        </div>

        <div className="milestoneInsightDrawerBody">
          {!milestone && !loading && !error && <p className="milestoneInsightDrawerEmpty">Select a milestone to see details.</p>}

          {loading && (
            <div className="milestoneInsightDrawerContent">
              <div className="milestoneInsightDrawerMeta">
                <div className="milestoneInsightDrawerSkeletonLine" style={{ width: 64, height: 18, borderRadius: 4 }} />
              </div>
              <SkeletonBlock lines={2} />
              <div className="milestoneInsightDrawerSection">
                <div className="milestoneInsightDrawerSectionTitle">Insight</div>
                <SkeletonBlock lines={4} />
                <SkeletonBlock lines={3} />
                <SkeletonBlock lines={2} />
              </div>
            </div>
          )}

          {error && (
            <div className="milestoneInsightDrawerErrorWrap">
              <p className="milestoneInsightDrawerError">{error}</p>
              {onRetry && (
                <button className="milestoneInsightDrawerRetryBtn" type="button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}

          {milestone && !loading && !error && (
            <div className="milestoneInsightDrawerContent">
              <div className="milestoneInsightDrawerMeta">
                <span className="milestoneInsightDrawerStatus">{milestone.status}</span>
              </div>
              {milestone.description ? (
                <p className="milestoneInsightDrawerDescription">{milestone.description}</p>
              ) : (
                <p className="milestoneInsightDrawerDescription milestoneInsightDrawerDescriptionMuted">No description.</p>
              )}

              <div className="milestoneInsightDrawerSection">
                <div className="milestoneInsightDrawerSectionTitle">Insight</div>
                {!insight && <div className="milestoneInsightDrawerPlaceholder">Insight not available.</div>}
                {insight && (
                  <div className="milestoneInsightDrawerInsight">
                    {Object.entries(insight.insight ?? {}).map(([key, value]) => (
                      <div key={key} className="milestoneInsightDrawerInsightBlock">
                        <div className="milestoneInsightDrawerInsightKey">{key.replace(/_/g, " ")}</div>
                        {renderValue(value)}
                      </div>
                    ))}
                    {insight.raw ? (
                      <div className="milestoneInsightDrawerRawWrap">
                        <div className="milestoneInsightDrawerInsightKey">raw</div>
                        <pre className="milestoneInsightDrawerPre">{insight.raw}</pre>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
