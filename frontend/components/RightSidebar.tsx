"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLayout } from "./LayoutContext";
import { RightSidebarChatMode } from "./RightSidebarChatMode";
import { RightSidebarTodayMode } from "./RightSidebarTodayMode";
import { TaskGuidePanel } from "./TaskGuidePanel";
import { PlanDetailContent } from "./PlanDetail";

// ── Navigation stack for sidebar views ──────────────────────────────────────
export type SidebarView = "main" | "milestone_detail" | "task_guide" | "plan_detail";

export function RightSidebar() {
  const { activeView, selectedTaskId, setSelectedTaskId, planDetailOpen, setPlanDetailOpen, setActivePlanId, setActivePlanTitle } = useLayout();
  const isToday = activeView === "today";

  // Navigation stack — tracks view history so back arrow goes to the right place
  const [viewStack, setViewStack] = useState<SidebarView[]>(["main"]);

  // Base widths
  const defaultChatWidth = 268;
  const defaultTodayWidth = 380; // wider for plan navigator

  const [userWidth, setUserWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Reset custom width when view changes, so it automatically adopts the new default
  useEffect(() => {
    setUserWidth(null);
  }, [activeView]);

  // When planDetailOpen is set, push plan_detail onto stack
  useEffect(() => {
    if (planDetailOpen) {
      setViewStack((prev) => {
        const top = prev[prev.length - 1];
        if (top === "plan_detail") return prev;
        return [...prev, "plan_detail"];
      });
    }
  }, [planDetailOpen]);

  // When planDetailOpen is cleared, pop back to main
  useEffect(() => {
    if (!planDetailOpen) {
      setViewStack((prev) => {
        const top = prev[prev.length - 1];
        if (top === "plan_detail") return ["main"];
        return prev;
      });
    }
  }, [planDetailOpen]);

  // When selectedTaskId is set from outside (e.g. TodayView), push task_guide onto stack
  useEffect(() => {
    if (selectedTaskId) {
      setViewStack((prev) => {
        const top = prev[prev.length - 1];
        if (top === "task_guide") return prev;
        return [...prev, "task_guide"];
      });
    }
  }, [selectedTaskId]);

  // When selectedTaskId is cleared, pop back to main
  useEffect(() => {
    if (!selectedTaskId) {
      setViewStack(["main"]);
    }
  }, [selectedTaskId]);

  const currentView = viewStack[viewStack.length - 1] ?? "main";

  const pushView = useCallback((view: SidebarView) => {
    setViewStack((prev) => [...prev, view]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    // If popping away from task_guide, clear selectedTaskId
    if (currentView === "task_guide") {
      setSelectedTaskId(null);
    }
    // If popping away from plan_detail, close plan detail
    if (currentView === "plan_detail") {
      setPlanDetailOpen(false);
      setActivePlanId(null);
      setActivePlanTitle(null);
    }
  }, [currentView, setSelectedTaskId, setPlanDetailOpen, setActivePlanId, setActivePlanTitle]);

  const planDetailWidth = 520;
  const currentWidth = userWidth ?? (currentView === "plan_detail" ? planDetailWidth : isToday ? defaultTodayWidth : defaultChatWidth);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 268 && newWidth <= 600) {
        setUserWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Header text depends on current view
  const headerLabel =
    currentView === "plan_detail"
      ? "Plan Detail"
      : currentView === "task_guide"
      ? "Task Guide"
      : currentView === "milestone_detail"
      ? "Milestone"
      : isToday
      ? "Plan Navigator"
      : "Today's Tasks";

  const headerDesc =
    currentView === "plan_detail"
      ? "Overview, milestones & tasks"
      : currentView === "task_guide"
      ? "Your step-by-step guide"
      : currentView === "milestone_detail"
      ? "Milestone details"
      : isToday
      ? "Tap a plan to explore milestones"
      : "Your schedule at a glance";

  return (
    <aside
      className="rightSidebar"
      aria-label="Contextual panel"
      ref={sidebarRef}
      style={{
        width: `${currentWidth}px`,
        minWidth: `${currentWidth}px`,
        transition: isResizing ? "none" : "width 0.35s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div
        className="rightSidebarResizer"
        onMouseDown={startResizing}
        title="Drag to resize sidebar"
      />
      <div className="rightSidebarHead">
        {currentView !== "main" && (
          <button className="rightSidebarBackBtn" onClick={popView} aria-label="Back">
            ←
          </button>
        )}
        <div className="rightSidebarLabel">{headerLabel}</div>
        <div className="rightSidebarDesc">{headerDesc}</div>
      </div>
      <div className="rightSidebarBody">
        <div key={currentView} className="rightSidebarContent">
          {currentView === "plan_detail" ? (
            <PlanDetailContent onClose={() => { setPlanDetailOpen(false); setActivePlanId(null); setActivePlanTitle(null); }} />
          ) : currentView === "task_guide" && selectedTaskId ? (
            <TaskGuidePanel
              taskId={selectedTaskId}
              onDone={() => {
                setSelectedTaskId(null);
              }}
              onBack={popView}
            />
          ) : currentView === "milestone_detail" ? (
            <RightSidebarTodayMode /> /* milestone detail is handled within TodayMode */
          ) : isToday ? (
            <RightSidebarTodayMode />
          ) : (
            <RightSidebarChatMode />
          )}
        </div>
      </div>
    </aside>
  );
}
