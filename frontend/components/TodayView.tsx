"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTodayTasks,
  updateTask,
  listActivePlans,
  listAllPlans,
  resumePlan,
  markDayBusy,
  type TaskResponse as AdaptiveTask,
  type PlanResponse,
} from "../lib/adaptive";
import { useLayout } from "./LayoutContext";
import { IconCheck } from "./icons";
import { getPlanColor } from "../lib/planColors";


// ── Plan status heuristic ──────────────────────────────────────────────────────
type PlanHealth = "on_track" | "slightly_behind" | "needs_attention";

function computePlanHealth(tasks: AdaptiveTask[]): PlanHealth {
  if (tasks.length === 0) return "on_track";
  const done = tasks.filter((t) => t.status === "done").length;
  const skipped = tasks.filter((t) => t.status === "skipped").length;
  const ratio = done / tasks.length;
  const skipRatio = skipped / tasks.length;
  if (skipRatio > 0.4) return "needs_attention";
  if (ratio < 0.3 && skipRatio > 0.1) return "slightly_behind";
  return "on_track";
}

const HEALTH_LABELS: Record<PlanHealth, string> = {
  on_track: "On Track",
  slightly_behind: "Slightly Behind",
  needs_attention: "Needs Attention",
};

const HEALTH_COLORS: Record<PlanHealth, { bg: string; color: string }> = {
  on_track: { bg: "rgba(34, 197, 94, 0.1)", color: "#16a34a" },
  slightly_behind: { bg: "rgba(234, 179, 8, 0.1)", color: "#a16207" },
  needs_attention: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626" },
};

// ── Date formatting ────────────────────────────────────────────────────────────
function formatTodayDate(): string {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const month = now.toLocaleDateString("en-US", { month: "long" });
  const date = now.getDate();
  return `${day}, ${month} ${date}`;
}

// ── EOD Summary Card ──────────────────────────────────────────────────────────
function EodSummaryCard({ onDismiss }: { onDismiss: () => void }) {
  // TODO: Fetch from GET /api/adaptive/eod-summary?date=today when endpoint exists
  return (
    <div className="todayEodCard">
      <div className="todayEodCardHeader">
        <span className="todayEodCardTitle">What changed last night</span>
        <button className="todayEodCardDismiss" onClick={onDismiss}>✕</button>
      </div>
      <p className="todayEodCardText">
        Your schedule was adjusted based on yesterday&apos;s progress. Some tasks were rescheduled.
      </p>
    </div>
  );
}

// ── Task Row ───────────────────────────────────────────────────────────────────
type TaskRowProps = {
  task: AdaptiveTask;
  acting: string | null;
  onCheckDone: (id: string) => void;
  onOpenDetail: (task: AdaptiveTask) => void;
};

function TaskRow({ task, acting, onCheckDone, onOpenDetail }: TaskRowProps) {
  const isDone = task.status === "done";
  const isSkipped = task.status === "skipped";
  const isRescheduled = task.carry_over_count > 0;
  const isActing = acting === task.id;

  return (
    <div
      className={`todayTaskRow ${isSkipped ? "todayTaskRowSkipped" : ""} ${isDone ? "todayTaskRowDone" : ""}`}
      onClick={() => onOpenDetail(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenDetail(task); }}
    >
      <button
        className={`todayTaskCheckbox ${isDone ? "todayTaskCheckboxChecked" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDone && !isActing) onCheckDone(task.id);
        }}
        disabled={isDone || isActing}
        aria-label={isDone ? "Completed" : "Mark done"}
      >
        {isDone && <IconCheck />}
      </button>

      <span className={`todayTaskRowTitle ${isDone ? "todayTaskRowTitleDone" : ""} ${isSkipped ? "todayTaskRowTitleSkipped" : ""}`}>
        {task.title}
      </span>

      {task.duration_minutes != null && (
        <span className="todayTaskDuration">{task.duration_minutes} min</span>
      )}

      {isRescheduled && !isSkipped && (
        <span className="todayTaskRescheduledBadge">rescheduled</span>
      )}
    </div>
  );
}

// ── Plan Section ──────────────────────────────────────────────────────────────
type PlanSectionProps = {
  plan: PlanResponse;
  planIndex: number;
  tasks: AdaptiveTask[];
  acting: string | null;
  onCheckDone: (id: string) => void;
  onOpenDetail: (task: AdaptiveTask) => void;
  onPlanClick: (plan: PlanResponse) => void;
};

function PlanSection({ plan, planIndex, tasks, acting, onCheckDone, onOpenDetail, onPlanClick }: PlanSectionProps) {
  const color = getPlanColor(planIndex);
  const health = computePlanHealth(tasks);
  const healthStyle = HEALTH_COLORS[health];

  return (
    <div className="todayPlanSection" style={{ borderLeftColor: color }}>
      <div className="todayPlanHeader" onClick={() => onPlanClick(plan)} style={{ cursor: "pointer" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onPlanClick(plan); }}>
        <span className="todayPlanName" style={{ color }}>{plan.title ?? "Untitled Plan"}</span>
        <span
          className="todayPlanStatusBadge"
          style={{ background: healthStyle.bg, color: healthStyle.color }}
        >
          {HEALTH_LABELS[health]}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="todayPlanEmpty">Nothing scheduled today</p>
      ) : (
        <div className="todayPlanTaskList">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              acting={acting}
              onCheckDone={onCheckDone}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main TodayView ────────────────────────────────────────────────────────────
export function TodayView() {
  const { todayRefreshKey, setActiveView, sendChatMessage, selectedTaskId, setSelectedTaskId, setActivePlanId, setActivePlanTitle, setPlanDetailOpen } = useLayout();

  const [tasks, setTasks] = useState<AdaptiveTask[]>([]);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [pausedPlans, setPausedPlans] = useState<PlanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [eodDismissed, setEodDismissed] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [t, p, allP] = await Promise.all([getTodayTasks(), listActivePlans(), listAllPlans()]);
      setTasks(t);
      setPlans(p);
      setPausedPlans(allP.filter((pl) => pl.status === "paused"));
    } catch (err) {
      console.error("Failed to load today data:", err);
      const msg = err instanceof Error ? err.message : "Failed to load tasks";
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, todayRefreshKey]);

  // Optimistic done handler
  const handleCheckDone = useCallback(async (taskId: string) => {
    setActing(taskId);
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "done" as const } : t))
    );
    try {
      await updateTask({ task_id: taskId, status: "done" });
    } catch (err) {
      console.error("Failed to mark done:", err);
      // Revert on failure
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: "pending" as const } : t))
      );
    } finally {
      setActing(null);
    }
  }, []);

  // Group tasks by plan (filter out paused plan tasks)
  const pausedPlanIds = useMemo(() => new Set(pausedPlans.map((p) => p.id)), [pausedPlans]);
  const activeTasks = useMemo(() => tasks.filter((t) => !pausedPlanIds.has(t.plan_id)), [tasks, pausedPlanIds]);
  const tasksByPlan = useMemo(() => {
    const map = new Map<string, AdaptiveTask[]>();
    for (const task of activeTasks) {
      const list = map.get(task.plan_id) ?? [];
      list.push(task);
      map.set(task.plan_id, list);
    }
    return map;
  }, [activeTasks]);

  const handleOpenDetail = useCallback((task: AdaptiveTask) => {
    setSelectedTaskId(task.id);
  }, [setSelectedTaskId]);

  const handleBusyClick = useCallback(() => {
    setActiveView("chat");
    sendChatMessage("I'm busy today, can you lighten my schedule?");
  }, [setActiveView, sendChatMessage]);

  const handlePlanClick = useCallback((plan: PlanResponse) => {
    setActivePlanId(plan.id);
    setActivePlanTitle(plan.title ?? "Plan");
    setPlanDetailOpen(true);
  }, [setActivePlanId, setActivePlanTitle, setPlanDetailOpen]);

  // Determine if any tasks were rescheduled (carry_over_count > 0) to show EOD card
  const hasRescheduledTasks = tasks.some((t) => t.carry_over_count > 0);

  // Click outside task rows clears selectedTaskId
  const handleMainClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".todayTaskRow")) {
      setSelectedTaskId(null);
    }
  }, [setSelectedTaskId]);

  return (
    <section className="viewContainer" aria-label="Today's tasks" onClick={handleMainClick}>
      {/* Date header */}
      <h2 className="todayDateHeader">{formatTodayDate()}</h2>

      {/* EOD summary card */}
      {hasRescheduledTasks && !eodDismissed && (
        <EodSummaryCard onDismiss={() => setEodDismissed(true)} />
      )}

      {/* Loading state */}
      {loading && <p className="viewEmpty">Loading tasks…</p>}

      {/* Error state with retry */}
      {!loading && fetchError && (
        <div className="todayErrorCard">
          <p className="todayErrorText">Could not load your tasks. The server may be starting up — please try again.</p>
          <button className="todayErrorRetryBtn" onClick={fetchData}>Retry</button>
        </div>
      )}

      {/* Plan sections */}
      {!loading && (
        <>
          {plans.length === 0 && tasks.length === 0 && (
            <p className="viewEmpty">No tasks for today. Enjoy your free time!</p>
          )}

          <div className="todayPlanList">
            {plans.map((plan, index) => (
              <PlanSection
                key={plan.id}
                plan={plan}
                planIndex={index}
                tasks={tasksByPlan.get(plan.id) ?? []}
                acting={acting}
                onCheckDone={handleCheckDone}
                onOpenDetail={handleOpenDetail}
                onPlanClick={handlePlanClick}
              />
            ))}

            {/* Tasks that belong to plans not in the active list */}
            {(() => {
              const activePlanIds = new Set(plans.map((p) => p.id));
              const orphanTasks = tasks.filter((t) => !activePlanIds.has(t.plan_id));
              if (orphanTasks.length === 0) return null;
              return (
                <PlanSection
                  plan={{ id: "__orphan__", title: "Other Tasks", status: "active", priority: "medium", intensity: "moderate", goal_id: null, user_id: null, created_at: "", updated_at: "" }}
                  planIndex={plans.length}
                  tasks={orphanTasks}
                  acting={acting}
                  onCheckDone={handleCheckDone}
                  onOpenDetail={handleOpenDetail}
                  onPlanClick={() => {}}
                />
              );
            })()}
          </div>
        </>
      )}

      {/* Floating "I'm busy today" button */}
      {!loading && activeTasks.length > 0 && (
        <button className="todayBusyBtn" onClick={handleBusyClick}>
          I&apos;m busy today
        </button>
      )}

      {/* Paused plans section */}
      {!loading && pausedPlans.length > 0 && (
        <div className="todayPausedSection">
          <h3 className="todayPausedTitle">Paused plans ({pausedPlans.length})</h3>
          {pausedPlans.map((plan) => (
            <div key={plan.id} className="todayPausedRow">
              <span className="todayPausedName">{plan.title ?? "Untitled Plan"}</span>
              <button
                className="todayPausedResumeBtn"
                onClick={async () => {
                  setActing(plan.id);
                  try {
                    await resumePlan({ plan_id: plan.id });
                    await fetchData();
                  } catch (err) {
                    console.error("Resume plan failed:", err);
                  } finally {
                    setActing(null);
                  }
                }}
                disabled={acting === plan.id}
              >
                Resume
              </button>
            </div>
          ))}
        </div>
      )}

    </section>
  );
}
