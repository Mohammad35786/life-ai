"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useLayout } from "./LayoutContext";
import {
  getTodayTasks,
  updateTask,
  listActivePlans,
  type TaskResponse,
  type PlanResponse,
} from "../lib/adaptive";
import { getPlanColor } from "../lib/planColors";

function ProgressRing({ pct, done, total }: { pct: number; done: number; total: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="rsbProgressRingWrap">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--gray-150)" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke="#1D9E75" strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
        <text x="32" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--gray-900)">{pct}%</text>
      </svg>
      <div className="rsbProgressLabel">{done}/{total} done</div>
    </div>
  );
}

export function RightSidebarChatMode() {
  const { todayRefreshKey, setActiveView, setSelectedTaskId } = useLayout();
  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([getTodayTasks(), listActivePlans()]);
      setTasks(t);
      setPlans(p);
    } catch (err) {
      console.error("RightSidebarChatMode fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData, todayRefreshKey]);

  const handleCheck = useCallback(async (taskId: string) => {
    setActing(taskId);
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: "done" as const } : t));
    try {
      await updateTask({ task_id: taskId, status: "done" });
    } catch {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: "pending" as const } : t));
    } finally {
      setActing(null);
    }
  }, []);

  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const tasksByPlan = plans.map((plan, i) => ({
    plan,
    color: getPlanColor(i),
    tasks: tasks.filter((t) => t.plan_id === plan.id),
  })).filter((g) => g.tasks.length > 0);

  const upNext = tasks.find((t) => t.status === "pending");

  if (loading) {
    return (
      <div className="rsbSkeleton">
        {[80, 60, 70, 50, 65].map((w, i) => (
          <div key={i} className="rsbSkeletonLine" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rsbEmpty">
        <div className="rsbEmptyIcon">🎉</div>
        <p>No tasks today. Enjoy your free time!</p>
      </div>
    );
  }

  return (
    <div>
      {/* Progress ring */}
      <ProgressRing pct={pct} done={done} total={total} />

      {/* Task groups by plan */}
      {tasksByPlan.map(({ plan, color, tasks: planTasks }) => (
        <div key={plan.id} className="rsbTaskGroup">
          <div className="rsbTaskGroupLabel">
            <span className="rsbTaskGroupDot" style={{ background: color }} />
            {plan.title ?? "Untitled"}
          </div>
          {planTasks.map((task) => {
            const isDone = task.status === "done";
            return (
              <div key={task.id} className="rsbTaskRow">
                <button
                  className={`rsbMiniCheck ${isDone ? "checked" : ""}`}
                  onClick={() => { if (!isDone && acting !== task.id) handleCheck(task.id); }}
                  disabled={isDone || acting === task.id}
                  aria-label={isDone ? "Done" : "Mark done"}
                >
                  {isDone && (
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span
                  className={`rsbTaskName ${isDone ? "done" : ""}`}
                  onClick={() => { if (!isDone) setSelectedTaskId(task.id); }}
                  style={{ cursor: !isDone ? "pointer" : "default" }}
                >
                  {task.title}
                </span>
                {task.duration_minutes != null && (
                  <span className="rsbTaskDur">{task.duration_minutes}m</span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Up next card */}
      {upNext && (
        <div className="rsbUpNextCard">
          <div className="rsbUpNextLabel">Up next</div>
          <div className="rsbUpNextTask">{upNext.title}</div>
          <button className="rsbUpNextBtn" onClick={() => handleCheck(upNext.id)} disabled={acting === upNext.id}>
            Mark done
          </button>
        </div>
      )}

      {/* Go to Today */}
      <button className="rsbGoToday" onClick={() => setActiveView("today")}>
        Go to Today →
      </button>
    </div>
  );
}
