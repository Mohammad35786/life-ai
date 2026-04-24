"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import {
  listActivePlans,
  getPlanMilestones,
  updateTask,
  type MilestoneResponse,
  type PlanResponse,
  type TaskResponse,
} from "../lib/adaptive";
import { getPlanColor, getPlanColorBg } from "../lib/planColors";
import { MilestoneMap } from "./MilestoneMap";

// ── Milestone Detail Slide-in Panel ──────────────────────────────────────────
function MilestoneDetail({
  milestone,
  planColor,
  onClose,
  onTaskDone,
  onTaskTap,
}: {
  milestone: MilestoneResponse | null;
  planColor: string;
  onClose: () => void;
  onTaskDone: (taskId: string) => void;
  onTaskTap: (taskId: string) => void;
}) {
  const [acting, setActing] = useState<string | null>(null);

  if (!milestone) return null;

  const isLocked = milestone.status === "locked";
  const isActive = milestone.status === "active";
  const isDone = milestone.status === "completed";

  const badgeStyle = isDone
    ? { bg: "rgba(29,158,117,0.12)", color: "#1D9E75", label: "Completed" }
    : isActive
    ? { bg: "rgba(91,156,246,0.12)", color: "#185FA5", label: "Active Now" }
    : { bg: "var(--gray-100)", color: "var(--text-tertiary)", label: "Locked" };

  const pendingTasks = milestone.tasks.filter((t) => t.status === "pending");

  const handleMarkDone = async (task: TaskResponse) => {
    if (acting) return;
    setActing(task.id);
    try {
      await updateTask({ task_id: task.id, status: "done" });
      onTaskDone(task.id);
    } catch (err) {
      console.error("Task update failed:", err);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="rsbMsDetail">
      {/* Topbar */}
      <div className="rsbMsDetailTop">
        <button className="rsbMsDetailBack" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <span className="rsbMsDetailTitle">{milestone.title}</span>
      </div>

      {/* Body */}
      <div className="rsbMsDetailBody">
        {/* Badge */}
        <span
          className="rsbMsDetailBadge"
          style={{ background: badgeStyle.bg, color: badgeStyle.color }}
        >
          {badgeStyle.label}
        </span>

        {/* Description */}
        {milestone.description && (
          <p className="rsbMsDetailDesc">{milestone.description}</p>
        )}

        {/* Tasks */}
        <div className="rsbMsDetailSec">Tasks in this milestone</div>
        {milestone.tasks.length === 0 && (
          <p className="rsbMuted">No tasks yet.</p>
        )}
        {milestone.tasks.map((task, i) => {
          const taskDone = task.status === "done";
          return (
            <div key={task.id} className="rsbMsTask" onClick={() => !taskDone && onTaskTap(task.id)} style={{ cursor: !taskDone ? "pointer" : "default" }}>
              <div className="rsbMsTaskNum">{i + 1}</div>
              <div className="rsbMsTaskInfo">
                <div className={`rsbMsTaskName ${taskDone ? "done" : ""}`}>{task.title}</div>
                {task.due_date && (
                  <div className="rsbMsTaskSub">
                    {task.duration_minutes != null ? `${task.duration_minutes} min · ` : ""}
                    {taskDone ? "done" : task.due_date}
                  </div>
                )}
              </div>
              {!taskDone && isActive && (
                <button
                  className="rsbMsTaskDoneBtn"
                  style={{ background: planColor }}
                  onClick={() => handleMarkDone(task)}
                  disabled={acting === task.id}
                >
                  ✓
                </button>
              )}
              {taskDone && (
                <span className="rsbMsTaskDoneCheck">✓</span>
              )}
            </div>
          );
        })}

        {/* CTA */}
        {!isLocked && pendingTasks.length > 0 && (
          <button
            className="rsbMsDetailCta"
            style={{ background: planColor }}
            onClick={() => handleMarkDone(pendingTasks[0])}
            disabled={!!acting}
          >
            Start today's task
          </button>
        )}
        {isLocked && (
          <div className="rsbMsDetailCtaLocked">
            🔒 Complete the previous milestone to unlock
          </div>
        )}
      </div>
    </div>
  );
}

// ── Plan Card ─────────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  color,
  expanded,
  milestones,
  loadingMs,
  onToggle,
  onMilestoneClick,
}: {
  plan: PlanResponse;
  color: string;
  expanded: boolean;
  milestones: MilestoneResponse[];
  loadingMs: boolean;
  onToggle: () => void;
  onMilestoneClick: (ms: MilestoneResponse) => void;
}) {
  const completedMs = milestones.filter((m) => m.status === "completed").length;
  const totalMs = milestones.length;
  const pct = totalMs > 0 ? Math.round((completedMs / totalMs) * 100) : 0;

  return (
    <div
      className={`rsbPlanCard ${expanded ? "open" : ""}`}
      onClick={onToggle}
    >
      <div className="rsbPlanCardHead">
        <span className="rsbPlanDot" style={{ background: color }} />
        <span className="rsbPlanName">{plan.title ?? "Untitled Plan"}</span>
        <span className="rsbPlanChevron" aria-hidden>▾</span>
      </div>

      {expanded && (
        <div className="rsbPlanCardBody" onClick={(e) => e.stopPropagation()}>
          {/* Progress bar */}
          {totalMs > 0 && (
            <>
              <div className="rsbPlanProgressBar">
                <div
                  className="rsbPlanProgressFill"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <div className="rsbPlanProgressPct">
                {pct}% complete · Milestone {completedMs + 1} of {totalMs}
              </div>
            </>
          )}

          {/* Milestone map */}
          {loadingMs ? (
            <div className="rsbSkeleton">
              {[55, 70, 45].map((w, i) => (
                <div key={i} className="rsbSkeletonLine" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : milestones.length === 0 ? (
            <p className="rsbMuted">No milestones yet.</p>
          ) : (
            <MilestoneMap
              milestones={milestones}
              planColor={color}
              onMilestoneClick={onMilestoneClick}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function RightSidebarTodayMode() {
  const { rightSidebarExpandedPlanId, setRightSidebarExpandedPlanId, setSelectedTaskId } = useLayout();
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [milestonesMap, setMilestonesMap] = useState<Record<string, MilestoneResponse[]>>({});
  const [loadingMsFor, setLoadingMsFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMs, setSelectedMs] = useState<MilestoneResponse | null>(null);
  const [selectedMsPlanColor, setSelectedMsPlanColor] = useState("#1D9E75");

  // Fetch plans
  useEffect(() => {
    listActivePlans()
      .then((p) => setPlans(p))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch milestones when a plan is expanded
  const milestonesMapRef = useRef(milestonesMap);
  milestonesMapRef.current = milestonesMap;

  const fetchMilestones = useCallback(async (planId: string) => {
    if (milestonesMapRef.current[planId]) return;
    setLoadingMsFor(planId);
    try {
      const ms = await getPlanMilestones(planId);
      setMilestonesMap((prev) => ({ ...prev, [planId]: ms }));
    } catch (err) {
      console.error("Failed to load milestones:", err);
    } finally {
      setLoadingMsFor(null);
    }
  }, []);

  const handleTogglePlan = useCallback((planId: string) => {
    const next = rightSidebarExpandedPlanId === planId ? null : planId;
    setRightSidebarExpandedPlanId(next);
    setSelectedMs(null);
    if (next) fetchMilestones(next);
  }, [rightSidebarExpandedPlanId, setRightSidebarExpandedPlanId, fetchMilestones]);

  const handleMilestoneClick = useCallback((ms: MilestoneResponse, planColor: string) => {
    setSelectedMs(ms);
    setSelectedMsPlanColor(planColor);
  }, []);

  const handleTaskDone = useCallback((taskId: string) => {
    setMilestonesMap((prev) => {
      const next = { ...prev };
      for (const planId in next) {
        next[planId] = next[planId].map((ms) => ({
          ...ms,
          tasks: ms.tasks.map((t) => t.id === taskId ? { ...t, status: "done" as const } : t),
        }));
      }
      return next;
    });
    setSelectedMs((ms) =>
      ms ? { ...ms, tasks: ms.tasks.map((t) => t.id === taskId ? { ...t, status: "done" as const } : t) } : null
    );
  }, []);

  if (loading) {
    return (
      <div className="rsbSkeleton">
        {[75, 55, 65, 50].map((w, i) => (
          <div key={i} className="rsbSkeletonLine" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="rsbEmpty">
        <div className="rsbEmptyIcon">🗺️</div>
        <p>No active plans. Chat with the AI to create your first plan.</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {plans.map((plan, i) => {
        const color = getPlanColor(i);
        return (
          <PlanCard
            key={plan.id}
            plan={plan}
            color={color}
            expanded={rightSidebarExpandedPlanId === plan.id}
            milestones={milestonesMap[plan.id] ?? []}
            loadingMs={loadingMsFor === plan.id}
            onToggle={() => handleTogglePlan(plan.id)}
            onMilestoneClick={(ms) => handleMilestoneClick(ms, color)}
          />
        );
      })}

      {/* Milestone detail slide-in panel */}
      <div className={`rsbMsDetailOverlay ${selectedMs ? "open" : ""}`}>
        <MilestoneDetail
          milestone={selectedMs}
          planColor={selectedMsPlanColor}
          onClose={() => setSelectedMs(null)}
          onTaskDone={handleTaskDone}
          onTaskTap={(taskId) => setSelectedTaskId(taskId)}
        />
      </div>
    </div>
  );
}
