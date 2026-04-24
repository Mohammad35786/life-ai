"use client";

import React, { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { apiGet, apiPost, apiPatch } from "../lib/api";
import { extractMemory, generatePlan, type ExtractedField, type QuickOption, type SessionContext } from "../lib/adaptive";
import { AppLayout } from "./AppLayout";
import { ChatView, GuidedEntryTabId } from "./ChatView";
import { useLayout } from "./LayoutContext";

// ── Types ──
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  extractedMemory?: ExtractedField[];
  setupQuickOptions?: QuickOption[];
  setupStep?: string;
  actions?: { action: string; target_id?: string; params?: Record<string, any> }[];
  mentionedPlan?: string | null;
};

const initialMessages: ChatMessage[] = [];

// ── Inner component — lives inside AppLayout so useLayout works ──
function ChatInner() {
  const { refreshToday, setActiveView, conversationToLoad, clearConversationToLoad, refreshConversations, pendingChatMessage, consumePendingChatMessage, activeView, activePlanId, selectedTaskId } = useLayout();

  // Chat state
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GuidedEntryTabId>("career");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState<string | null>(null);

  // Refs
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Fetch conversation history handled by LeftSidebar via shared refreshConversations key

  // Load a conversation when sidebar requests it
  useEffect(() => {
    if (!conversationToLoad) return;
    apiGet<any>(`/api/conversations/${conversationToLoad}`)
      .then((data) => {
        setActiveConversationId(data.id);
        setMessages(data.messages || []);
        clearConversationToLoad();
      })
      .catch((err) => {
        console.error("Failed to load conversation:", err);
        clearConversationToLoad();
      });
  }, [conversationToLoad, clearConversationToLoad, setActiveConversationId]);

  // Consume pending chat message (e.g. from PlansDrawer "New Plan" button)
  useEffect(() => {
    if (!pendingChatMessage) return;
    const msg = consumePendingChatMessage();
    if (msg) submitChatMessage(msg);
  }, [pendingChatMessage]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Auto-resize textarea
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    autoResize(e.target);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !isChatLoading) {
        e.currentTarget.form?.requestSubmit();
      }
    }
  };

  const submitChatMessage = async (rawContent: string, source: "chat" | "guided" = "chat") => {
    const content = rawContent.trim();
    if (!content) return;

    const systemInstruction = "You are a helpful assistant.\nContinue the conversation naturally.";
    const conversationPrompt = [
      systemInstruction,
      "",
      ...messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
      `User: ${content}`,
    ].join("\n");

    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content };
    let currentPlusUser: ChatMessage[] = [];
    setMessages((current) => {
      currentPlusUser = [...current, userMsg];
      return currentPlusUser;
    });
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      setIsChatLoading(true);
      const sessionContext: SessionContext = {
        active_tab: activeView === "today" ? "today" : "chat",
        open_plan_id: activePlanId,
        open_milestone_id: null,
        open_task_id: selectedTaskId,
      };
      const payload = { message: conversationPrompt, source, session_context: sessionContext };
      const res = await apiPost<any>("/api/chat", payload);
      const replyContent = typeof res.reply === "object" ? JSON.stringify(res.reply, null, 2) : res.reply;

      const botMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: replyContent,
        actions: res.actions?.length > 0 ? res.actions : undefined,
        mentionedPlan: res.mentioned_plan ?? null,
      };
      const updatedMessages = [...currentPlusUser, botMsg];
      setMessages(updatedMessages);

      // ── Extract memory from conversation ──
      const conversationText = updatedMessages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      extractMemory({ conversation: conversationText })
        .then((result) => {
          if (result.count > 0 && result.extracted.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botMsg.id ? { ...m, extractedMemory: result.extracted } : m
              )
            );
          }
        })
        .catch((err) => console.error("Memory extraction failed:", err));

      // Auto-save to conversation history
      if (!activeConversationId) {
        const title = content.split(" ").slice(0, 6).join(" ") + (content.split(" ").length > 6 ? "..." : "");
        apiPost<any>("/api/conversations", { title })
          .then((conv) => {
            setActiveConversationId(conv.id);
            return apiPatch<any>(`/api/conversations/${conv.id}`, { messages: updatedMessages });
          })
          .then(() => {
            refreshConversations();
          })
          .catch(console.error);
      } else {
        apiPatch<any>(`/api/conversations/${activeConversationId}`, { messages: updatedMessages })
          .then(() => {
            refreshConversations();
          })
          .catch(console.error);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "An unknown error occurred.";
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: `Error: ${detail}` },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitChatMessage(draft, "chat");
  };

  const handleGuidedQuestionSelect = (question: string) => {
    if (isChatLoading) return;
    setDraft(question);
    textareaRef.current?.focus();
    window.requestAnimationFrame(() => {
      if (textareaRef.current) autoResize(textareaRef.current);
      void submitChatMessage(question, "guided");
    });
  };

  const handleCreatePlan = async (memoryId: string) => {
    setCreatingPlan(memoryId);
    try {
      await generatePlan({ memory_id: memoryId });
      refreshToday();
      setActiveView("today");
    } catch (err) {
      console.error("Plan generation failed:", err);
    } finally {
      setCreatingPlan(null);
    }
  };

  return (
    <ChatView
      messages={messages}
      isChatLoading={isChatLoading}
      draft={draft}
      onDraftChange={handleDraftChange}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      textareaRef={textareaRef}
      scrollAnchorRef={scrollAnchorRef}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onQuestionSelect={handleGuidedQuestionSelect}
      onCreatePlan={handleCreatePlan}
      creatingPlan={creatingPlan}
      onPlanCreated={() => {
        refreshToday();
        refreshConversations();
      }}
      onAddMessage={(msg) => {
        setMessages((prev) => [...prev, msg]);
      }}
      onViewToday={() => {
        refreshToday();
        setActiveView("today");
      }}
    />
  );
}

// ── Main Component — outer shell provides AppLayout context ──
export function ChatWindow() {
  const { user, signOut } = useAuth();
  const [chatKey, setChatKey] = useState(0);

  const handleNewChat = () => setChatKey((k) => k + 1);

  return (
    <AppLayout user={user} onSignOut={signOut} onNewChat={handleNewChat}>
      <ChatInner key={chatKey} />
    </AppLayout>
  );
}
