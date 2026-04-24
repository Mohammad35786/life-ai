"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getTaskDetail,
  updateTask,
  type TaskDetailData,
  type TaskDetailResource,
  type TaskDetailHowToStep,
  type TaskResponse,
} from "../lib/adaptive";
import { apiPost } from "../lib/api";
import { IconClose, IconCheck, IconSkip, IconSend } from "./icons";

type TaskDetailDrawerProps = {
  taskId: string | null;
  task: TaskResponse | null;
  planName: string;
  onClose: () => void;
  onTaskUpdate: (taskId: string, newStatus: string) => void;
};

const RESOURCE_TYPE_LABELS: Record<TaskDetailResource["type"], string> = {
  video: "VIDEO",
  article: "ARTICLE",
  app: "APP",
  book: "BOOK",
};

const DIFFICULTY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  easy: { bg: "rgba(34, 197, 94, 0.1)", color: "#16a34a", label: "Easy" },
  medium: { bg: "rgba(234, 179, 8, 0.1)", color: "#a16207", label: "Medium" },
  hard: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Hard" },
};

function SkeletonLoader() {
  return (
    <div className="taskDetailDrawerSkeleton">
      {[1, 2, 3].map((i) => (
        <div key={i} className="taskDetailDrawerSkeletonRow" />
      ))}
    </div>
  );
}

export function TaskDetailDrawer({ taskId, task, planName, onClose, onTaskUpdate }: TaskDetailDrawerProps) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);

  // Fetch detail when taskId changes
  useEffect(() => {
    if (!taskId) {
      setDetail(null);
      setChatMessages([]);
      setChatInput("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTaskDetail(taskId)
      .then((res) => {
        if (!cancelled) setDetail(res.detail);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load task detail");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [taskId]);

  // Close on Escape
  useEffect(() => {
    if (!taskId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [taskId, onClose]);

  // Swipe-down dismiss
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (panelRef.current && dy > 0) {
      panelRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null || !panelRef.current) return;
    const dy = e.changedTouches[0].clientY - dragStartY.current;
    if (dy > 80) {
      onClose();
    }
    panelRef.current.style.transform = "";
    dragStartY.current = null;
  }, [onClose]);

  const handleStatusAction = async (status: "done" | "skipped") => {
    if (!task) return;
    setActing(status);
    try {
      await updateTask({ task_id: task.id, status });
      onTaskUpdate(task.id, status);
    } catch (err) {
      console.error(`Failed to mark ${status}:`, err);
    } finally {
      setActing(null);
    }
  };

  const handleReschedule = async () => {
    // TODO: wire to POST /api/adaptive/tasks/{id}/reschedule when UI for date picking is added
    console.log("Reschedule not yet implemented");
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatLoading || !task) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);
    try {
      const systemNote = `[Context: User is asking about the task "${task.title}" in the plan "${planName}". Help them with specific, actionable advice.]`;
      const conversationPrompt = [systemNote, `User: ${userMsg}`].join("\n");
      const res = await apiPost<{ reply: string }>("/api/chat", {
        message: conversationPrompt,
        source: "task_detail",
        task_id: task.id,
        plan_id: task.plan_id,
      });
      const replyContent = typeof res.reply === "object" ? JSON.stringify(res.reply, null, 2) : res.reply;
      setChatMessages((prev) => [...prev, { role: "assistant", content: replyContent }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (!taskId || !task) return null;

  const difficulty = detail?.estimated_difficulty ?? task.difficulty;
  const diffStyle = DIFFICULTY_STYLES[difficulty === "intermediate" ? "medium" : difficulty] ?? DIFFICULTY_STYLES.medium;

  return (
    <>
      {/* Backdrop */}
      <div className="taskDetailDrawerBackdrop" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="taskDetailDrawerPanel"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle */}
        <div className="taskDetailDrawerHandle" />

        {/* Header */}
        <div className="taskDetailDrawerHeader">
          <div className="taskDetailDrawerHeaderInfo">
            <h3 className="taskDetailDrawerTitle">{task.title}</h3>
            <div className="taskDetailDrawerMeta">
              {task.duration_minutes && (
                <span className="taskDetailDrawerDuration">{task.duration_minutes} min</span>
              )}
              <span
                className="taskDetailDrawerDifficulty"
                style={{ background: diffStyle.bg, color: diffStyle.color }}
              >
                {diffStyle.label}
              </span>
            </div>
          </div>
          <div className="taskDetailDrawerHeaderActions">
            {task.status === "pending" && (
              <>
                <button
                  className="taskDetailDrawerActionBtn taskDetailDrawerActionDone"
                  onClick={() => handleStatusAction("done")}
                  disabled={acting !== null}
                  title="Done"
                >
                  <IconCheck /> Done
                </button>
                <button
                  className="taskDetailDrawerActionBtn taskDetailDrawerActionSkip"
                  onClick={() => handleStatusAction("skipped")}
                  disabled={acting !== null}
                  title="Skip"
                >
                  <IconSkip /> Skip
                </button>
                <button
                  className="taskDetailDrawerActionBtn taskDetailDrawerActionReschedule"
                  onClick={handleReschedule}
                  disabled={acting !== null}
                  title="Reschedule"
                >
                  Reschedule
                </button>
              </>
            )}
            <button className="taskDetailDrawerCloseBtn" onClick={onClose} title="Close">
              <IconClose />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="taskDetailDrawerBody">
          {loading && <SkeletonLoader />}
          {error && <p className="taskDetailDrawerError">{error}</p>}

          {!loading && !error && detail && (
            <>
              {/* What is this? */}
              <div className="taskDetailDrawerSection">
                <h4 className="taskDetailDrawerSectionTitle">What is this?</h4>
                <p className="taskDetailDrawerSectionText">{detail.what_is_this}</p>
              </div>

              {/* How to do it */}
              {detail.how_to_do_it.length > 0 && (
                <div className="taskDetailDrawerSection">
                  <h4 className="taskDetailDrawerSectionTitle">How to do it</h4>
                  <div className="taskDetailDrawerStepList">
                    {detail.how_to_do_it.map((step: TaskDetailHowToStep) => (
                      <div key={step.step} className="taskDetailDrawerStepRow">
                        <span className="taskDetailDrawerStepCircle">{step.step}</span>
                        <span className="taskDetailDrawerStepText">{step.instruction}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resources */}
              {detail.resources.length > 0 && (
                <div className="taskDetailDrawerSection">
                  <h4 className="taskDetailDrawerSectionTitle">Resources</h4>
                  <div className="taskDetailDrawerResourceList">
                    {detail.resources.map((r: TaskDetailResource, i: number) => (
                      <div key={i} className="taskDetailDrawerResourceCard">
                        <span className="taskDetailDrawerResourceBadge">{RESOURCE_TYPE_LABELS[r.type]}</span>
                        <span className="taskDetailDrawerResourceTitle">{r.title}</span>
                        <span className="taskDetailDrawerResourceDesc">{r.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Today's example */}
              {detail.todays_example && (
                <div className="taskDetailDrawerSection">
                  <h4 className="taskDetailDrawerSectionTitle">Today&apos;s example</h4>
                  <div className="taskDetailDrawerExampleBox">{detail.todays_example}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Chat section */}
        <div className="taskDetailDrawerChatSection">
          {chatMessages.length > 0 && (
            <div className="taskDetailDrawerChatMessages">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user"
                      ? "taskDetailDrawerChatMsg taskDetailDrawerChatMsgUser"
                      : "taskDetailDrawerChatMsg taskDetailDrawerChatMsgAssistant"
                  }
                >
                  {msg.content}
                </div>
              ))}
              {chatLoading && (
                <div className="taskDetailDrawerChatMsg taskDetailDrawerChatMsgAssistant">Thinking…</div>
              )}
            </div>
          )}
          <div className="taskDetailDrawerChatInput">
            <input
              type="text"
              className="taskDetailDrawerChatInputField"
              placeholder="Ask about this task…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleChatSend(); }}
              disabled={chatLoading}
            />
            <button
              className="taskDetailDrawerChatSendBtn"
              onClick={handleChatSend}
              disabled={!chatInput.trim() || chatLoading}
            >
              <IconSend />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
