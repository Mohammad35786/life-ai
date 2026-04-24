"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import {
  getTaskDetail,
  getTodayTasks,
  updateTask,
  checkMilestoneCompletion,
  type TaskDetailData,
  type TaskDetailResource,
  type TaskDetailHowToStep,
  type TaskResponse,
} from "../lib/adaptive";
import { apiPost } from "../lib/api";
import { IconCheck, IconSkip, IconSend } from "./icons";

// ── Types ────────────────────────────────────────────────────────────────────
type TaskGuidePanelProps = {
  taskId: string;
  onDone: () => void;
  onBack: () => void;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

// ── Resource type labels ─────────────────────────────────────────────────────
const RESOURCE_TYPE_LABELS: Record<TaskDetailResource["type"], string> = {
  video: "VIDEO",
  article: "ARTICLE",
  app: "APP",
  book: "BOOK",
};

// ── Skeleton loader ──────────────────────────────────────────────────────────
function SkeletonLoader() {
  return (
    <div className="tgSkeleton">
      {[70, 85, 60, 90, 55, 75, 65].map((w, i) => (
        <div key={i} className="tgSkeletonLine" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// ── TaskGuidePanel ──────────────────────────────────────────────────────────
export function TaskGuidePanel({ taskId, onDone, onBack }: TaskGuidePanelProps) {
  const { activeView, activePlanId, refreshToday } = useLayout();

  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [celebrationMsg, setCelebrationMsg] = useState<string | null>(null);

  // Inline chat
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatAnchorRef = useRef<HTMLDivElement>(null);

  // Fetch task detail
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTaskDetail(taskId)
      .then((res) => {
        if (!cancelled) {
          setDetail(res.detail);
          setTaskTitle(res.detail.what_is_this?.slice(0, 60) || "Task");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load task guide");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [taskId]);

  // Auto-scroll chat
  useEffect(() => {
    chatAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ── Done handler ──────────────────────────────────────────────────────────
  const handleDone = useCallback(async () => {
    setActing("done");
    try {
      await updateTask({ task_id: taskId, status: "done" });
      refreshToday();

      // Check milestone completion — look up the task's milestone_id
      try {
        const todayTasks = await getTodayTasks();
        const thisTask = todayTasks.find((t: TaskResponse) => t.id === taskId);
        if (thisTask?.milestone_id) {
          const checkRes = await checkMilestoneCompletion(thisTask.milestone_id);
          if (checkRes.completed && checkRes.next_milestone) {
            setCelebrationMsg(`Milestone complete! ${checkRes.next_milestone.title} unlocked.`);
          }
        }
      } catch {
        // Silently ignore — milestone check is best-effort
      }

      onDone();
    } catch (err) {
      console.error("Failed to mark done:", err);
    } finally {
      setActing(null);
    }
  }, [taskId, onDone, refreshToday]);

  // ── Skip handler ──────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    setActing("skip");
    try {
      await updateTask({ task_id: taskId, status: "skipped" });
      refreshToday();
      onDone();
    } catch (err) {
      console.error("Failed to skip:", err);
    } finally {
      setActing(null);
    }
  }, [taskId, onDone, refreshToday]);

  // ── Chat send ─────────────────────────────────────────────────────────────
  const handleChatSend = useCallback(async () => {
    const content = chatInput.trim();
    if (!content || chatLoading) return;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content }]);
    setChatLoading(true);
    try {
      const res = await apiPost<{ reply: string }>('/api/chat', {
        message: content,
        source: 'task_guide',
        session_context: {
          active_tab: activeView === 'today' ? 'today' : 'chat',
          open_plan_id: activePlanId,
          open_milestone_id: null,
          open_task_id: taskId,
        },
      });
      const replyContent = typeof res.reply === "object" ? JSON.stringify(res.reply, null, 2) : res.reply;
      setChatMessages((prev) => [...prev, { role: "assistant", content: replyContent }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that." }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, activeView, activePlanId, taskId]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="tgPanel">
      {/* Celebration banner */}
      {celebrationMsg && (
        <div className="tgCelebration">
          {celebrationMsg}
        </div>
      )}

      {/* Header with Done / Skip */}
      <div className="tgHeader">
        <button className="tgBackBtn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <span className="tgTitle">{taskTitle}</span>
        <div className="tgHeaderActions">
          <button
            className="tgActionBtn tgActionDone"
            onClick={handleDone}
            disabled={acting !== null}
          >
            <IconCheck /> Done
          </button>
          <button
            className="tgActionBtn tgActionSkip"
            onClick={handleSkip}
            disabled={acting !== null}
          >
            <IconSkip /> Skip
          </button>
        </div>
      </div>

      <div className="tgDivider" />

      {/* Body */}
      <div className="tgBody">
        {loading && <SkeletonLoader />}
        {error && <p className="tgError">{error}</p>}

        {!loading && !error && detail && (
          <>
            {/* WHAT IS THIS */}
            <div className="tgSection">
              <h4 className="tgSectionTitle">WHAT IS THIS</h4>
              <p className="tgSectionText">{detail.what_is_this}</p>
            </div>

            {/* WHY TODAY */}
            {detail.why_it_matters && (
              <div className="tgSection">
                <h4 className="tgSectionTitle">WHY TODAY</h4>
                <p className="tgSectionText">{detail.why_it_matters}</p>
              </div>
            )}

            {/* HOW TO DO IT */}
            {detail.how_to_do_it.length > 0 && (
              <div className="tgSection">
                <h4 className="tgSectionTitle">HOW TO DO IT</h4>
                <div className="tgStepList">
                  {detail.how_to_do_it.map((step: TaskDetailHowToStep) => (
                    <div key={step.step} className="tgStepRow">
                      <span className="tgStepCircle">{step.step}</span>
                      <span className="tgStepText">{step.instruction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RESOURCES */}
            {detail.resources.length > 0 && (
              <div className="tgSection">
                <h4 className="tgSectionTitle">RESOURCES</h4>
                <div className="tgResourceList">
                  {detail.resources.map((r: TaskDetailResource, i: number) => (
                    <div key={i} className="tgResourceCard">
                      <span className="tgResourceBadge">{RESOURCE_TYPE_LABELS[r.type]}</span>
                      <span className="tgResourceTitle">{r.title}</span>
                      <span className="tgResourceDesc">{r.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TODAY'S EXAMPLE */}
            {detail.todays_example && (
              <div className="tgSection">
                <h4 className="tgSectionTitle">TODAY&apos;S EXAMPLE</h4>
                <div className="tgExampleBox">{detail.todays_example}</div>
              </div>
            )}

            {/* EXPERT TIP */}
            {detail.expert_tip && (
              <div className="tgSection">
                <h4 className="tgSectionTitle">EXPERT TIP</h4>
                <p className="tgSectionText">{detail.expert_tip}</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="tgDivider" />

      {/* Inline chat */}
      <div className="tgChatSection">
        {chatMessages.length > 0 && (
          <div className="tgChatMessages">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.role === "user"
                    ? "tgChatMsg tgChatMsgUser"
                    : "tgChatMsg tgChatMsgAssistant"
                }
              >
                {msg.content}
              </div>
            ))}
            {chatLoading && (
              <div className="tgChatMsg tgChatMsgAssistant">Thinking…</div>
            )}
            <div ref={chatAnchorRef} />
          </div>
        )}
        <div className="tgChatInput">
          <input
            type="text"
            className="tgChatInputField"
            placeholder="Ask about this task…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }}
            disabled={chatLoading}
          />
          <button
            className="tgChatSendBtn"
            onClick={handleChatSend}
            disabled={!chatInput.trim() || chatLoading}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}
