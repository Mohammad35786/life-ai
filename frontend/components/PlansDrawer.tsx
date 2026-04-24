"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import { IconClose, IconMore, IconPlus } from "./icons";
import {
  listAllPlans,
  getPlanMilestones,
  patchPlan,
  deletePlan,
  resumePlan,
  pausePlan,
  type PlanResponse,
  type MilestoneResponse,
} from "../lib/adaptive";

// ── Color cycle for left borders ──
const BORDER_COLORS = ["#7c3aed", "#0d9488", "#2563eb", "#d97706", "#ef4444"];

function borderColor(index: number): string {
  return BORDER_COLORS[index % BORDER_COLORS.length];
}

// ── Status badge logic ──
type StatusLabel = "On Track" | "Slightly Behind" | "Needs Attention";

function computeStatus(completionPct: number, expectedPct: number): StatusLabel {
  if (completionPct >= expectedPct) return "On Track";
  const diff = expectedPct - completionPct;
  if (diff <= 20) return "Slightly Behind";
  return "Needs Attention";
}

const STATUS_STYLES: Record<StatusLabel, { bg: string; color: string }> = {
  "On Track": { bg: "rgba(34, 197, 94, 0.1)", color: "#16a34a" },
  "Slightly Behind": { bg: "rgba(217, 119, 6, 0.1)", color: "#b45309" },
  "Needs Attention": { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626" },
};

// ── Enriched plan type with computed fields ──
type EnrichedPlan = PlanResponse & {
  _completionPct: number;
  _expectedPct: number;
  _activeMilestoneIdx: number;
  _totalMilestones: number;
  _statusLabel: StatusLabel;
};

function enrichPlan(plan: PlanResponse, milestones: MilestoneResponse[]): EnrichedPlan {
  const totalMilestones = milestones.length || 1;
  const activeIdx = milestones.findIndex((m) => m.status === "active");
  const _activeMilestoneIdx = activeIdx >= 0 ? activeIdx + 1 : 0;

  // Count all tasks across all milestones
  let totalTasks = 0;
  let doneTasks = 0;
  for (const ms of milestones) {
    for (const t of ms.tasks) {
      totalTasks++;
      if (t.status === "done") doneTasks++;
    }
  }

  const _completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  // Expected progress: if milestone 2 of 5 is active, expected ~40%
  const _expectedPct = Math.round(((_activeMilestoneIdx || 1) / totalMilestones) * 100);
  const _statusLabel = computeStatus(_completionPct, _expectedPct);

  return {
    ...plan,
    _completionPct,
    _expectedPct,
    _activeMilestoneIdx,
    _totalMilestones: totalMilestones,
    _statusLabel,
  };
}

// ── PlansDrawer component ──
export function PlansDrawer() {
  const { isPlanDrawerOpen, togglePlanDrawer, setActivePlanId, setActivePlanTitle, setActiveView, sendChatMessage } = useLayout();
  const [plans, setPlans] = useState<EnrichedPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const rawPlans = await listAllPlans();
      // Fetch milestones for all plans in parallel instead of sequentially
      const milestoneResults = await Promise.all(
        rawPlans.map((plan) =>
          getPlanMilestones(plan.id).catch(() => [] as MilestoneResponse[])
        )
      );
      const enriched = rawPlans.map((plan, i) =>
        enrichPlan(plan, milestoneResults[i])
      );
      setPlans(enriched);
    } catch (err) {
      console.error("Failed to load plans:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlanDrawerOpen) fetchPlans();
  }, [isPlanDrawerOpen, fetchPlans]);

  // Close on Escape
  useEffect(() => {
    if (!isPlanDrawerOpen) return;
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") togglePlanDrawer();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isPlanDrawerOpen, togglePlanDrawer]);

  const handlePlanClick = (planId: string, planTitle: string) => {
    setActivePlanId(planId);
    setActivePlanTitle(planTitle);
    togglePlanDrawer();
  };

  const handleNewPlan = () => {
    togglePlanDrawer();
    setActiveView("chat");
    sendChatMessage("I want to create a new plan");
  };

  const handlePausePlan = useCallback(async (planId: string) => {
    try {
      await pausePlan({ plan_id: planId });
      setMenuOpenId(null);
      await fetchPlans();
    } catch (err) {
      console.error("Pause plan failed:", err);
    }
  }, [fetchPlans]);

  const handleResumePlan = useCallback(async (planId: string) => {
    try {
      await resumePlan({ plan_id: planId });
      setMenuOpenId(null);
      await fetchPlans();
    } catch (err) {
      console.error("Resume plan failed:", err);
    }
  }, [fetchPlans]);

  const handleDeletePlan = useCallback(async (planId: string) => {
    try {
      await deletePlan(planId);
      setConfirmDeleteId(null);
      setMenuOpenId(null);
      await fetchPlans();
    } catch (err) {
      console.error("Delete plan failed:", err);
    }
  }, [fetchPlans]);

  if (!isPlanDrawerOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="plansDrawerBackdrop" onClick={togglePlanDrawer} />

      {/* Drawer panel */}
      <div className="plansDrawerPanel">
        <div className="plansDrawerHeader">
          <h2 className="plansDrawerTitle">Plans</h2>
          <button
            className="plansDrawerCloseBtn"
            type="button"
            onClick={togglePlanDrawer}
            aria-label="Close plans drawer"
          >
            <IconClose />
          </button>
        </div>

        <div className="plansDrawerBody">
          {loading && <p className="plansDrawerEmpty">Loading plans…</p>}

          {!loading && plans.length === 0 && (
            <p className="plansDrawerEmpty">No active plans yet.</p>
          )}

          {!loading &&
            plans.map((plan, idx) => {
              const statusStyle = STATUS_STYLES[plan._statusLabel];
              const isPaused = plan.status === "paused";
              const isMenuOpen = menuOpenId === plan.id;
              const isConfirmDelete = confirmDeleteId === plan.id;
              return (
                <div
                  key={plan.id}
                  className="plansDrawerCardWrapper"
                >
                  <button
                    className="plansDrawerCard"
                    type="button"
                    onClick={() => handlePlanClick(plan.id, plan.title ?? "Untitled Plan")}
                    style={{ borderLeftColor: borderColor(idx) }}
                  >
                    <div className="plansDrawerCardTitle">{plan.title ?? "Untitled Plan"}</div>

                    <div className="plansDrawerCardMeta">
                      Milestone {plan._activeMilestoneIdx} of {plan._totalMilestones}
                    </div>

                    {/* Progress bar */}
                    <div className="plansDrawerProgressBar">
                      <div
                        className="plansDrawerProgressBarFill"
                        style={{
                          width: `${plan._completionPct}%`,
                          background: borderColor(idx),
                        }}
                      />
                    </div>

                    <div className="plansDrawerCardFooter">
                      <span
                        className="plansDrawerStatusBadge"
                        style={{ background: statusStyle.bg, color: statusStyle.color }}
                      >
                        {plan._statusLabel}
                      </span>

                      {isPaused && (
                        <span className="plansDrawerPausedBadge">Paused</span>
                      )}

                      <span className="plansDrawerPct">{plan._completionPct}%</span>
                    </div>
                  </button>
                  {/* ⋮ menu button */}
                  <button
                    className="plansDrawerMenuBtn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(isMenuOpen ? null : plan.id);
                      setConfirmDeleteId(null);
                    }}
                    aria-label="Plan actions"
                  >
                    <IconMore />
                  </button>
                  {/* Popover menu */}
                  {isMenuOpen && (
                    <div className="plansDrawerMenu" ref={menuRef}>
                      {!isPaused && (
                        <button
                          className="plansDrawerMenuItem"
                          onClick={(e) => { e.stopPropagation(); handlePausePlan(plan.id); }}
                        >
                          Pause plan
                        </button>
                      )}
                      {isPaused && (
                        <button
                          className="plansDrawerMenuItem"
                          onClick={(e) => { e.stopPropagation(); handleResumePlan(plan.id); }}
                        >
                          Resume plan
                        </button>
                      )}
                      {!isConfirmDelete ? (
                        <button
                          className="plansDrawerMenuItem plansDrawerMenuItemDanger"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(plan.id); }}
                        >
                          Delete plan
                        </button>
                      ) : (
                        <div className="plansDrawerMenuConfirm">
                          <span>Delete permanently?</span>
                          <div className="plansDrawerMenuConfirmBtns">
                            <button
                              className="plansDrawerMenuConfirmYes"
                              onClick={(e) => { e.stopPropagation(); handleDeletePlan(plan.id); }}
                            >
                              Yes, delete
                            </button>
                            <button
                              className="plansDrawerMenuConfirmNo"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        <div className="plansDrawerFooter">
          <button className="plansDrawerNewBtn" type="button" onClick={handleNewPlan}>
            <IconPlus />
            <span>New Plan</span>
          </button>
        </div>
      </div>
    </>
  );
}
