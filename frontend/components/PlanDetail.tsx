"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import { IconCheck, IconClose, IconSend } from "./icons";
import {
  getPlanDetail,
  sendPlanChat,
  updateTask,
  checkMilestoneCompletion,
  type PlanDetailResponse,
  type PlanChatAction,
  type MilestoneStatus,
  type TaskStatus,
} from "../lib/adaptive";

// ── Milestone status styling ──
const MS_STYLES: Record<MilestoneStatus, { bg: string; border: string; text: string; ring?: string; label: string }> = {
  completed: { bg: "#7c3aed", border: "#7c3aed", text: "#fff", label: "Completed" },
  active: { bg: "#2563eb", border: "#2563eb", text: "#fff", ring: "0 0 0 3px rgba(37,99,235,0.25)", label: "Active" },
  locked: { bg: "transparent", border: "var(--gray-300)", text: "var(--gray-400)", label: "Locked" },
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  setup: { bg: "rgba(234,179,8,0.12)", color: "#a16207", label: "Setup" },
  active: { bg: "rgba(34,197,94,0.12)", color: "#16a34a", label: "Active" },
  paused: { bg: "rgba(239,68,68,0.12)", color: "#dc2626", label: "Paused" },
  completed: { bg: "rgba(124,58,237,0.12)", color: "#7c3aed", label: "Completed" },
};

// ── Chat message type ──
type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: PlanChatAction[];
};

// ── PlanDetailContent — renders plan detail UI (works inside sidebar or overlay) ──
export function PlanDetailContent({ onClose }: { onClose?: () => void }) {
  const { activePlanId, setActivePlanId, setActivePlanTitle, planDetailOpen, setPlanDetailOpen, setSelectedTaskId, refreshToday } = useLayout();

  const [detail, setDetail] = useState<PlanDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingTaskId, setActingTaskId] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatAnchorRef = useRef<HTMLDivElement>(null);

  // ── Fetch plan detail ──
  const fetchDetail = useCallback(async () => {
    if (!activePlanId) return;
    setLoading(true);
    try {
      const data = await getPlanDetail(activePlanId);
      setDetail(data);
    } catch (err) {
      console.error("Failed to load plan detail:", err);
    } finally {
      setLoading(false);
    }
  }, [activePlanId]);

  useEffect(() => {
    if (activePlanId && planDetailOpen) fetchDetail();
  }, [activePlanId, planDetailOpen, fetchDetail]);

  // Auto-scroll chat
  useEffect(() => {
    chatAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Close handler ──
  const handleClose = () => {
    setPlanDetailOpen(false);
    setActivePlanId(null);
    setActivePlanTitle(null);
    setChatMessages([]);
    onClose?.();
  };

  // ── Task toggle ──
  const handleToggleTask = async (taskId: string, currentStatus: TaskStatus, milestoneId?: string | null) => {
    const newStatus: TaskStatus = currentStatus === "done" ? "pending" : "done";
    setActingTaskId(taskId);
    try {
      await updateTask({ task_id: taskId, status: newStatus });
      await fetchDetail();
      refreshToday();
      // Check milestone completion when marking done
      if (newStatus === "done" && milestoneId) {
        try {
          const checkRes = await checkMilestoneCompletion(milestoneId);
          if (checkRes.completed && checkRes.next_milestone) {
            // Refresh detail again to reflect unlocked milestone + new tasks
            await fetchDetail();
            refreshToday();
          }
        } catch (e) {
          console.error("Milestone completion check failed:", e);
        }
      }
    } catch (err) {
      console.error("Failed to update task:", err);
    } finally {
      setActingTaskId(null);
    }
  };

  // ── Chat send ──
  const handleSendChat = async () => {
    const content = chatDraft.trim();
    if (!content || chatLoading || !activePlanId) return;

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatDraft("");
    if (chatInputRef.current) chatInputRef.current.style.height = "auto";

    setChatLoading(true);
    try {
      const res = await sendPlanChat(activePlanId, content);
      const botMsg: ChatMsg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.reply,
        actions: res.actions.length > 0 ? res.actions : undefined,
      };
      setChatMessages((prev) => [...prev, botMsg]);

      // If actions were returned, refresh detail to reflect changes
      if (res.actions.length > 0) {
        setTimeout(() => fetchDetail(), 500);
      }
    } catch (err) {
      const errDetail = err instanceof Error ? err.message : "Unknown error";
      const errMsg: ChatMsg = { id: crypto.randomUUID(), role: "assistant", content: `Error: ${errDetail}` };
      setChatMessages((prev) => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  // ── Don't render if not open ──
  if (!planDetailOpen || !activePlanId) return null;

  const plan = detail?.plan;
  const stats = detail?.stats;
  const milestones = detail?.milestones ?? [];

  // Task groupings across all milestones
  const allTasks = milestones.flatMap((ms) => ms.tasks);
  const completedTasks = allTasks.filter((t) => t.status === "done");
  const skippedTasks = allTasks.filter((t) => t.status === "skipped");
  const pendingTasks = allTasks.filter((t) => t.status === "pending" || t.status === "partial");

  const statusBadge = plan ? STATUS_BADGE[plan.status] ?? STATUS_BADGE.active : STATUS_BADGE.active;

  return (
    <div className="pdContent">
      {loading && !detail && (
        <div className="pdLoading">
          <div className="pdSpinner" />
          <span>Loading plan…</span>
        </div>
      )}

      {plan && stats && (
        <>
          {/* ════════════════════════════════════════════════════════════════
              A. OVERVIEW HEADER
          */}
          <div className="pdOverview">
            <div className="pdOverviewTop">
              <h2 className="pdTitle">{plan.title ?? "Untitled Plan"}</h2>
              <span className="pdStatusBadge" style={{ background: statusBadge.bg, color: statusBadge.color }}>
                {statusBadge.label}
              </span>
            </div>
            <div className="pdOverviewStats">
              <div className="pdStat">
                <span className="pdStatValue">{stats.progress_pct}%</span>
                <span className="pdStatLabel">Progress</span>
              </div>
              <div className="pdStat">
                <span className="pdStatValue">{stats.completed_tasks}</span>
                <span className="pdStatLabel">Done</span>
              </div>
              <div className="pdStat">
                <span className="pdStatValue">{stats.remaining_tasks}</span>
                <span className="pdStatLabel">Remaining</span>
              </div>
              <div className="pdStat">
                <span className="pdStatValue">{stats.total_milestones}</span>
                <span className="pdStatLabel">Milestones</span>
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════════
              B. PROGRESS SECTION
          */}
          <div className="pdSection">
            <h3 className="pdSectionTitle">Progress</h3>
            <div className="pdProgressBar">
              <div className="pdProgressFill" style={{ width: `${stats.progress_pct}%` }} />
            </div>
            <div className="pdProgressInfo">
              <span>{stats.completed_tasks} of {stats.total_tasks} tasks complete</span>
              <span>{stats.completed_milestones} of {stats.total_milestones} milestones done</span>
            </div>
            <div className="pdNextCards">
              {stats.current_milestone && (
                <div className="pdNextCard">
                  <span className="pdNextCardLabel">Current Milestone</span>
                  <span className="pdNextCardValue">{stats.current_milestone.title}</span>
                </div>
              )}
              {stats.next_milestone && (
                <div className="pdNextCard pdNextCardUpcoming">
                  <span className="pdNextCardLabel">Next Milestone</span>
                  <span className="pdNextCardValue">{stats.next_milestone.title}</span>
                </div>
              )}
              {stats.next_task && (
                <div className="pdNextCard pdNextCardTask">
                  <span className="pdNextCardLabel">Next Task</span>
                  <span className="pdNextCardValue">{stats.next_task.title}</span>
                </div>
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════════
              C. MILESTONES SECTION
          */}
          <div className="pdSection">
            <h3 className="pdSectionTitle">Milestones</h3>
            <div className="pdMilestoneList">
              {milestones.map((ms, idx) => {
                const style = MS_STYLES[ms.status];
                const msDone = ms.tasks.filter((t) => t.status === "done").length;
                const msTotal = ms.tasks.length;
                const msPct = msTotal > 0 ? Math.round((msDone / msTotal) * 100) : 0;
                return (
                  <div key={ms.id} className={`pdMilestoneRow ${ms.status === "active" ? "pdMilestoneRowActive" : ""}`}>
                    <div
                      className="pdMilestoneBubble"
                      style={{ background: style.bg, border: `2px solid ${style.border}`, color: style.text, boxShadow: style.ring }}
                    >
                      {idx + 1}
                    </div>
                    <div className="pdMilestoneInfo">
                      <div className="pdMilestoneTitle">{ms.title}</div>
                      <div className="pdMilestoneMeta">
                        <span className="pdMilestoneBadge" style={{ background: style.bg, color: style.text }}>
                          {style.label}
                        </span>
                        <span className="pdMilestoneTaskCount">{msDone}/{msTotal} tasks</span>
                        <span className="pdMilestonePct">{msPct}%</span>
                      </div>
                      {msTotal > 0 && (
                        <div className="pdMilestoneMiniBar">
                          <div className="pdMilestoneMiniFill" style={{ width: `${msPct}%`, background: style.border }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════════
              D. TASKS SECTION
          */}
          <div className="pdSection pdTasksSection">
            <h3 className="pdSectionTitle">Tasks</h3>

            {/* Next task prominent */}
            {stats.next_task && (
              <div className="pdNextTaskRow" onClick={() => setSelectedTaskId(stats.next_task!.id)} style={{ cursor: "pointer" }}>
                <span className="pdNextTaskLabel">NEXT UP</span>
                <span className="pdNextTaskTitle">{stats.next_task.title}</span>
                <span className="pdNextTaskArrow">→</span>
              </div>
            )}

            {/* Pending tasks */}
            {pendingTasks.length > 0 && (
              <div className="pdTaskGroup">
                <h4 className="pdTaskGroupTitle">Remaining ({pendingTasks.length})</h4>
                {pendingTasks.map((task) => (
                  <div key={task.id} className="pdTaskRow" onClick={() => setSelectedTaskId(task.id)} style={{ cursor: "pointer" }}>
                    <button
                      className="pdTaskCheckbox"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleToggleTask(task.id, task.status, task.milestone_id); }}
                      disabled={actingTaskId === task.id}
                      aria-label="Mark complete"
                    />
                    <span className="pdTaskTitle">{task.title}</span>
                    {task.duration_minutes != null && <span className="pdTaskDuration">{task.duration_minutes}m</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <div className="pdTaskGroup">
                <h4 className="pdTaskGroupTitle">Completed ({completedTasks.length})</h4>
                {completedTasks.map((task) => (
                  <div key={task.id} className="pdTaskRow pdTaskRowDone">
                    <button
                      className="pdTaskCheckbox pdTaskCheckboxChecked"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleToggleTask(task.id, task.status, task.milestone_id); }}
                      disabled={actingTaskId === task.id}
                      aria-label="Mark incomplete"
                    >
                      <IconCheck />
                    </button>
                    <span className="pdTaskTitle pdTaskTitleDone">{task.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Skipped tasks */}
            {skippedTasks.length > 0 && (
              <div className="pdTaskGroup">
                <h4 className="pdTaskGroupTitle">Skipped ({skippedTasks.length})</h4>
                {skippedTasks.map((task) => (
                  <div key={task.id} className="pdTaskRow pdTaskRowSkipped">
                    <span className="pdTaskSkipIcon">⊘</span>
                    <span className="pdTaskTitle pdTaskTitleSkipped">{task.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════
              E. AI CHAT SECTION
          */}
          <div className="pdSection pdChatSection">
            <h3 className="pdSectionTitle">Plan Chat</h3>
            <p className="pdChatHint">Ask to reframe milestones, add tasks, skip tasks, or get advice.</p>

            <div className="pdChatMessages">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`pdChatMsg ${msg.role === "user" ? "pdChatMsgUser" : "pdChatMsgAssistant"}`}>
                  <div className="pdChatMsgContent">{msg.content}</div>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="pdChatActions">
                      {msg.actions.map((a, i) => (
                        <span key={i} className="pdChatActionBadge">{a.action.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && <div className="pdChatMsg pdChatMsgAssistant">Thinking…</div>}
              <div ref={chatAnchorRef} />
            </div>

            <div className="pdChatInput">
              <textarea
                ref={chatInputRef}
                className="pdChatTextarea"
                placeholder="Ask about this plan…"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={handleChatKeyDown}
                rows={1}
              />
              <button
                className="pdChatSendBtn"
                type="button"
                onClick={handleSendChat}
                disabled={!chatDraft.trim() || chatLoading}
              >
                <IconSend />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── PlanDetail — legacy overlay wrapper (no longer rendered in AppLayout) ──
export function PlanDetail() {
  const { planDetailOpen, activePlanId, setPlanDetailOpen, setActivePlanId, setActivePlanTitle } = useLayout();

  const handleClose = () => {
    setPlanDetailOpen(false);
    setActivePlanId(null);
    setActivePlanTitle(null);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  if (!planDetailOpen || !activePlanId) return null;

  return (
    <div className="pdOverlay" onClick={handleOverlayClick}>
      <div className="pdPanel">
        <button className="pdCloseBtn" onClick={handleClose} aria-label="Close">
          <IconClose />
        </button>
        <PlanDetailContent onClose={handleClose} />
      </div>
    </div>
  );
}
