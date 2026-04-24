"use client";

import React, { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { IconSend } from "./icons";
import {
  startPlanSetup,
  savePlanDuration,
  savePlanSchedule,
  type QuickOption,
} from "../lib/adaptive";

type ChatRole = "user" | "assistant";

export type ExtractedMemory = {
  key: string;
  value: string;
  id: string | null;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  extractedMemory?: ExtractedMemory[];
  setupQuickOptions?: QuickOption[];
  setupStep?: string;
  actions?: { action: string; target_id?: string; params?: Record<string, any> }[];
  mentionedPlan?: string | null;
};

type GuidedEntryTabConfig = {
  id: "career" | "job" | "learn" | "test";
  label: string;
  questions: string[];
};

export type GuidedEntryTabId = GuidedEntryTabConfig["id"];

const guidedEntryTabs: GuidedEntryTabConfig[] = [
  {
    id: "career",
    label: "Help select a career path",
    questions: [
      "What career suits my skills?",
      "How do I choose between multiple career options?",
      "What skills should I learn for future jobs?",
      "Suggest a plan based on my interests",
    ],
  },
  {
    id: "job",
    label: "Help me find a job",
    questions: [
      "How can I improve my resume?",
      "What jobs match my current skills?",
      "How do I prepare for interviews?",
      "Create a job search plan for me",
    ],
  },
  {
    id: "learn",
    label: "Learn a Topic",
    questions: [
      "Create a learning plan for [topic]",
      "Explain this topic simply",
      "Give me a 7-day learning plan",
      "What should I learn first?",
    ],
  },
  {
    id: "test",
    label: "Test my Knowledge",
    questions: [
      "Take a quiz on [topic]",
      "Test my understanding of basics",
      "Give me practice questions",
      "Evaluate my skill level",
    ],
  },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ChatViewProps {
  messages: ChatMessage[];
  isChatLoading: boolean;
  draft: string;
  onDraftChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  scrollAnchorRef: React.RefObject<HTMLDivElement | null>;
  activeTab: GuidedEntryTabId;
  onTabChange: (tabId: GuidedEntryTabId) => void;
  onQuestionSelect: (question: string) => void;
  onCreatePlan?: (memoryId: string) => void;
  creatingPlan?: string | null;
  onPlanCreated?: () => void;
  onAddMessage?: (msg: ChatMessage) => void;
  onViewToday?: () => void;
}

function GuidedEntryPanel({
  activeTab,
  disabled,
  onQuestionSelect,
  onTabChange,
}: {
  activeTab: GuidedEntryTabId;
  disabled: boolean;
  onQuestionSelect: (question: string) => void;
  onTabChange: (tabId: GuidedEntryTabId) => void;
}) {
  const currentTab = guidedEntryTabs.find((tab) => tab.id === activeTab) ?? guidedEntryTabs[0];

  return (
    <div className="guidedEntryPanel">
      <h2 className="guidedEntryHeading">How can I help you?</h2>

      <div className="guidedEntryTabList" role="tablist" aria-label="Guided AI entry topics">
        {guidedEntryTabs.map((tab) => {
          const isActive = tab.id === currentTab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "guidedEntryTab guidedEntryTabActive" : "guidedEntryTab"}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div key={currentTab.id} className="guidedEntryQuestions" aria-live="polite">
        {currentTab.questions.map((question) => (
          <button
            key={question}
            type="button"
            className="guidedEntryQuestion"
            onClick={() => onQuestionSelect(question)}
            disabled={disabled}
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatView({
  messages,
  isChatLoading,
  draft,
  onDraftChange,
  onSubmit,
  onKeyDown,
  textareaRef,
  scrollAnchorRef,
  activeTab,
  onTabChange,
  onQuestionSelect,
  onCreatePlan,
  creatingPlan,
  onPlanCreated,
  onAddMessage,
  onViewToday,
}: ChatViewProps) {
  const [savingPlanMsgId, setSavingPlanMsgId] = useState<string | null>(null);
  const [savedPlanMsgIds, setSavedPlanMsgIds] = useState<Set<string>>(new Set());
  const [planError, setPlanError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // ── Plan setup flow state ──────────────────────────────────────────────────
  const [setupPlanId, setSetupPlanId] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<string | null>(null); // ask_duration | ask_schedule | generating_milestones | complete
  const [setupQuickOptions, setSetupQuickOptions] = useState<QuickOption[]>([]);
  const [setupLoading, setSetupLoading] = useState(false);
  const [customDays, setCustomDays] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // Auto-dismiss toast after 4s
  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  // Scroll to bottom when setup messages are added
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, setupQuickOptions, showCustomPicker, scrollAnchorRef]);

  const _addAssistantMsg = useCallback(
    (content: string, quickOptions?: QuickOption[], step?: string) => {
      if (!onAddMessage) return;
      onAddMessage({
        id: `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        content,
        setupQuickOptions: quickOptions,
        setupStep: step,
      });
    },
    [onAddMessage],
  );

  const _addUserMsg = useCallback(
    (content: string) => {
      if (!onAddMessage) return;
      onAddMessage({
        id: `user-setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content,
      });
    },
    [onAddMessage],
  );

  // ── Save as Plan (new interactive flow) ────────────────────────────────────
  const handleSaveAsPlan = useCallback(
    async (message: ChatMessage) => {
      setSavingPlanMsgId(message.id);
      setPlanError(null);
      try {
        const conversation = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        const result = await startPlanSetup({
          conversation,
        });

        setSetupPlanId(result.plan_id);
        setSetupStep(result.setup_step);
        setSetupQuickOptions(result.quick_options);

        _addAssistantMsg(result.message, result.quick_options, result.setup_step);

        setSavedPlanMsgIds((prev) => new Set(prev).add(message.id));
      } catch (err) {
        setPlanError(err instanceof Error ? err.message : "Failed to start plan setup");
      } finally {
        setSavingPlanMsgId(null);
      }
    },
    [messages, _addAssistantMsg],
  );

  // ── Duration pill click ────────────────────────────────────────────────────
  const handleDurationSelect = useCallback(
    async (option: QuickOption) => {
      if (!setupPlanId) return;
      _addUserMsg(option.label);
      setSetupQuickOptions([]);
      setSetupLoading(true);

      try {
        const result = await savePlanDuration(setupPlanId, {
          duration_days: option.value as number,
        });

        setSetupStep(result.setup_step);
        setSetupQuickOptions(result.quick_options);
        _addAssistantMsg(result.message, result.quick_options, result.setup_step);
      } catch (err) {
        setPlanError(err instanceof Error ? err.message : "Failed to save duration");
      } finally {
        setSetupLoading(false);
      }
    },
    [setupPlanId, _addUserMsg, _addAssistantMsg],
  );

  // ── Schedule pill click ────────────────────────────────────────────────────
  const handleScheduleSelect = useCallback(
    async (scheduleType: string, days?: number[]) => {
      if (!setupPlanId) return;
      const label = scheduleType === "custom" ? "Custom days" : scheduleType;
      _addUserMsg(label);
      setSetupQuickOptions([]);
      setShowCustomPicker(false);
      setSetupLoading(true);

      try {
        const result = await savePlanSchedule(setupPlanId, {
          type: scheduleType,
          days: days ?? null,
        });

        setSetupStep(result.setup_step);

        if (result.setup_step === "ready") {
          const planTitle = result.first_milestone || "your plan";
          const msCount = result.milestone_count ?? 0;
          const todayTasks = result.tasks_today ?? 0;
          const readyMsg =
            `Your ${planTitle} plan is ready.\n${msCount} milestone${msCount !== 1 ? "s" : ""}. First task: ${todayTasks > 0 ? "today" : "soon"}.\nHead to Today to get started.`;
          _addAssistantMsg(readyMsg);
          setToastMsg("Plan created! View it in Today →");
          onPlanCreated?.();
          setSetupPlanId(null);
        } else if (result.setup_step === "generating_milestones") {
          _addAssistantMsg("Building your milestones…");
          setToastMsg("Plan created! Generating milestones…");
          onPlanCreated?.();
        } else {
          _addAssistantMsg("Setup complete!");
          setToastMsg("Plan created! View it in Plans →");
          onPlanCreated?.();
        }
      } catch (err) {
        setPlanError(err instanceof Error ? err.message : "Failed to save schedule");
      } finally {
        setSetupLoading(false);
      }
    },
    [setupPlanId, _addUserMsg, _addAssistantMsg, onPlanCreated],
  );

  // ── Custom day picker confirm ──────────────────────────────────────────────
  const handleCustomConfirm = useCallback(() => {
    const selectedDays = customDays
      .map((selected, idx) => (selected ? idx : -1))
      .filter((idx) => idx >= 0);
    handleScheduleSelect("custom", selectedDays.length > 0 ? selectedDays : undefined);
  }, [customDays, handleScheduleSelect]);

  const handleQuickOptionClick = useCallback(
    (option: QuickOption) => {
      if (setupStep === "ask_duration") {
        handleDurationSelect(option);
      } else if (setupStep === "ask_schedule") {
        if (option.value === "custom") {
          setShowCustomPicker(true);
        } else {
          handleScheduleSelect(option.value as string);
        }
      }
    },
    [setupStep, handleDurationSelect, handleScheduleSelect],
  );

  return (
    <section className="chatShell" aria-label="Chat interface">
      {/* Top-right Save as Plan button — always visible when chat has messages */}
      {messages.length > 0 && !setupPlanId && (
        <div className="chatTopBar">
          <button
            className="chatSavePlanBtn"
            onClick={() => {
              const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
              if (lastAssistantMsg) handleSaveAsPlan(lastAssistantMsg);
            }}
            disabled={savingPlanMsgId !== null}
          >
            {savingPlanMsgId ? (
              <span className="chatSavePlanSpinner" />
            ) : null}
            {savingPlanMsgId ? "Saving…" : "Save as Plan →"}
          </button>
          {planError && savingPlanMsgId === null && (
            <span className="chatSavePlanError">{planError}</span>
          )}
        </div>
      )}
      {/* Message pane */}
      <div className="messagePane">
        {messages.length > 0 ? (
          <div className="messageList">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "messageRow messageRowUser"
                    : "messageRow messageRowAssistant"
                }
              >
                <div
                  className={
                    message.role === "user"
                      ? "messageBubble messageBubbleUser"
                      : "messageBubble messageBubbleAssistant"
                  }
                >
                  <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
                  {/* Plan mention indicator + action badges */}
                  {message.role === "assistant" && message.mentionedPlan && (
                    <div className="chatPlanMentionHint">
                      Context: {message.mentionedPlan}
                    </div>
                  )}
                  {message.role === "assistant" && message.actions && message.actions.length > 0 && (
                    <div className="chatPlanActions">
                      {message.actions.map((a, i) => (
                        <span key={i} className="chatPlanActionBadge">{a.action.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  )}
                  {/* Create Plan button when memory extracted */}
                  {message.role === "assistant" &&
                    message.extractedMemory &&
                    message.extractedMemory.length > 0 &&
                    onCreatePlan && (
                      <div className="chatMemoryActions">
                        <span className="chatMemoryLabel">
                          Detected: {message.extractedMemory.map((f) => f.key).join(", ")}
                        </span>
                        {message.extractedMemory
                          .filter((f) => f.id && f.key === "goal")
                          .map((f) => (
                            <button
                              key={f.id}
                              className="chatCreatePlanBtn"
                              onClick={() => f.id && onCreatePlan(f.id)}
                              disabled={creatingPlan === f.id}
                            >
                              {creatingPlan === f.id ? "Creating…" : "Create Plan"}
                            </button>
                          ))}
                      </div>
                    )}
                  {/* Quick option pills for setup flow */}
                  {message.role === "assistant" &&
                    message.setupQuickOptions &&
                    message.setupQuickOptions.length > 0 && (
                      <div className="setupPillRow">
                        {message.setupQuickOptions.map((opt) => (
                          <button
                            key={String(opt.value)}
                            type="button"
                            className="setupPillBtn"
                            onClick={() => handleQuickOptionClick(opt)}
                            disabled={setupLoading}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  {/* View My Plan button after setup completion */}
                  {message.role === "assistant" &&
                    !message.setupQuickOptions?.length &&
                    message.content.includes("plan is ready") &&
                    setupStep === "ready" && onViewToday && (
                      <div className="setupPillRow" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="setupDayConfirmBtn"
                          onClick={onViewToday}
                        >
                          View My Plan →
                        </button>
                      </div>
                    )}
                  {/* Custom day picker */}
                  {message.role === "assistant" && showCustomPicker && (
                    <div className="setupDayPicker">
                      {DAY_LABELS.map((day, idx) => (
                        <button
                          key={day}
                          type="button"
                          className={
                            customDays[idx]
                              ? "setupDayBtn setupDayBtnActive"
                              : "setupDayBtn"
                          }
                          onClick={() => {
                            const next = [...customDays];
                            next[idx] = !next[idx];
                            setCustomDays(next);
                          }}
                        >
                          {day}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="setupDayConfirmBtn"
                        onClick={handleCustomConfirm}
                        disabled={!customDays.some(Boolean) || setupLoading}
                      >
                        Confirm
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {isChatLoading && (
              <article className="messageRow messageRowAssistant">
                <div className="messageBubble messageBubbleAssistant">
                  <p>Thinking...</p>
                </div>
              </article>
            )}
            {setupLoading && (
              <article className="messageRow messageRowAssistant">
                <div className="messageBubble messageBubbleAssistant">
                  <p>Building your milestones…</p>
                </div>
              </article>
            )}
            <div ref={scrollAnchorRef} />
          </div>
        ) : (
          <div className="emptyState">
            <GuidedEntryPanel
              activeTab={activeTab}
              disabled={isChatLoading}
              onQuestionSelect={onQuestionSelect}
              onTabChange={onTabChange}
            />
          </div>
        )}
      </div>

      {/* Success toast */}
      {toastMsg && (
        <div className="chatToast">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Composer */}
      <div className="composerWrap">
        <form className="composerForm" onSubmit={onSubmit}>
          <label className="srOnly" htmlFor="chat-input">Message</label>
          <div className="composerBox" style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              id="chat-input"
              className="composerTextarea"
              rows={1}
              value={draft}
              onChange={onDraftChange}
              onKeyDown={onKeyDown}
              placeholder="Message Life Agent…"
              autoComplete="off"
              disabled={isChatLoading}
            />
            <button
              className="composerSend"
              type="submit"
              disabled={!draft.trim() || isChatLoading}
              aria-label="Send message"
            >
              <IconSend />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
