"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useLayout } from "./LayoutContext";
import { IconChevronDown, IconTrash } from "./icons";
import {
  getTodayTasks,
  updateTask,
  listActivePlans,
  pausePlan,
  markDayBusy,
  listMemory,
  deleteMemory,
  type TaskResponse,
  type PlanResponse,
  type MemoryResponse,
} from "../lib/adaptive";

export function RightPanel() {
  const { rightPanelOpen, setRightPanelOpen } = useLayout();

  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [memories, setMemories] = useState<MemoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, p, m] = await Promise.all([getTodayTasks(), listActivePlans(), listMemory()]);
      setTasks(t);
      setPlans(p);
      setMemories(m);
    } catch (err) {
      console.error("RightPanel fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (rightPanelOpen) fetchData();
  }, [rightPanelOpen, fetchData]);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const totalPending = tasks.filter((t) => t.status === "pending").length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const handleBusy = async () => {
    setActing("busy");
    try {
      await markDayBusy();
      await fetchData();
    } catch (err) {
      console.error("Mark busy failed:", err);
    } finally {
      setActing(null);
    }
  };

  const handlePausePlan = async (planId: string) => {
    setActing(planId);
    try {
      await pausePlan({ plan_id: planId });
      await fetchData();
    } catch (err) {
      console.error("Pause plan failed:", err);
    } finally {
      setActing(null);
    }
  };

  const handleAddMore = async () => {
    // Mark one pending task as partial to signal "pulled" — backend pull-next is available
    const pending = tasks.find((t) => t.status === "pending");
    if (!pending) return;
    setActing("add");
    try {
      await updateTask({ task_id: pending.id, status: "partial", feedback_text: "auto-pulled via quick action" });
      await fetchData();
    } catch (err) {
      console.error("Add more failed:", err);
    } finally {
      setActing(null);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    setActing(memoryId);
    try {
      await deleteMemory(memoryId);
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    } catch (err) {
      console.error("Delete memory failed:", err);
    } finally {
      setActing(null);
    }
  };

  return (
    <aside
      className={rightPanelOpen ? "rightPanel rightPanelOpen" : "rightPanel"}
      aria-label="Side panel"
    >
      {/* Header */}
      <div className="rightPanelHeader">
        <span className="rightPanelTitle">Overview</span>
        <button
          className="rightPanelCloseBtn"
          type="button"
          onClick={() => setRightPanelOpen(false)}
          aria-label="Close panel"
        >
          <IconChevronDown />
        </button>
      </div>

      {/* Body */}
      <div className="rightPanelBody">
        {loading && <div className="rpSection rpMuted">Loading…</div>}

        {!loading && (
          <>
            {/* ── Active Plans Summary ── */}
            <div className="rpSection">
              <h3 className="rpSectionTitle">Active Plans</h3>
              {plans.length === 0 && <p className="rpMuted">No active plans</p>}
              {plans.map((plan) => (
                <div key={plan.id} className="rpPlanRow">
                  <div className="rpPlanInfo">
                    <span className="rpPlanName">{plan.title ?? "Untitled"}</span>
                    <span className="rpPlanPriority">{plan.priority}</span>
                  </div>
                  <button
                    className="rpSmallBtn"
                    onClick={() => handlePausePlan(plan.id)}
                    disabled={acting === plan.id}
                  >
                    Pause
                  </button>
                </div>
              ))}
            </div>

            {/* ── Today Progress ── */}
            <div className="rpSection">
              <h3 className="rpSectionTitle">Today Progress</h3>
              <div className="rpProgressRow">
                <span className="rpProgressLabel">{doneCount}/{totalCount} done</span>
                <span className="rpProgressPct">{progressPct}%</span>
              </div>
              <div className="rpProgressBar">
                <div className="rpProgressBarFill" style={{ width: `${progressPct}%` }} />
              </div>
              {totalPending > 0 && (
                <p className="rpMuted">{totalPending} remaining</p>
              )}
            </div>

            {/* ── What I know about you ── */}
            <div className="rpSection">
              <button
                className="rpCollapsibleToggle"
                type="button"
                onClick={() => setMemoryOpen((v) => !v)}
              >
                <span className="rpSectionTitle" style={{ margin: 0 }}>What I know about you</span>
                <IconChevronDown rotated={memoryOpen} />
              </button>
              {memoryOpen && (
                <div className="rpMemoryPanel">
                  <div className="rpMemoryInfo">
                    <span>This is what the AI uses to generate and adjust your plans.</span>
                    <span className="rpMemoryInfoTooltip" title="This is what the AI uses to generate and adjust your plans.">ℹ</span>
                  </div>
                  {memories.length === 0 && (
                    <p className="rpMuted">Nothing yet. Start a conversation and save it as a plan.</p>
                  )}
                  {memories.map((mem) => (
                    <div key={mem.id} className="rpMemoryRow">
                      <div className="rpMemoryContent">
                        <span className="rpMemorySummary">
                          {mem.value.length > 80 ? mem.value.slice(0, 80) + "…" : mem.value}
                        </span>
                        <span className="rpMemoryDate">
                          {new Date(mem.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="rpMemoryDeleteBtn"
                        onClick={() => handleDeleteMemory(mem.id)}
                        disabled={acting === mem.id}
                        aria-label="Delete memory"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Quick Actions ── */}
            <div className="rpSection">
              <h3 className="rpSectionTitle">Quick Actions</h3>
              <div className="rpActions">
                <button className="rpActionBtn" onClick={handleBusy} disabled={acting === "busy"}>
                  I'm busy today
                </button>
                {plans.length > 0 && (
                  <button
                    className="rpActionBtn"
                    onClick={() => handlePausePlan(plans[0].id)}
                    disabled={acting === plans[0].id}
                  >
                    Pause a plan
                  </button>
                )}
                <button className="rpActionBtn" onClick={handleAddMore} disabled={acting === "add" || totalPending === 0}>
                  Add more tasks
                </button>
                <button className="rpActionBtn" onClick={fetchData} disabled={loading}>
                  Refresh tasks
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
