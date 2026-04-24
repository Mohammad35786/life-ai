"use client";

import React, { createContext, useContext } from "react";

// ── View types for state-based navigation ──
export type ViewId = "chat" | "today";

// ── Layout context — shared state for all layout children ──
export type OverlayItem = {
  id: string;
  content: React.ReactNode;
  dismissible?: boolean;
};

export type LayoutContextValue = {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  pushOverlay: (item: OverlayItem) => void;
  popOverlay: (id?: string) => void;
  todayRefreshKey: number;
  refreshToday: () => void;
  conversationsRefreshKey: number;
  refreshConversations: () => void;
  conversationToLoad: string | null;
  loadConversation: (id: string) => void;
  clearConversationToLoad: () => void;
  isPlanDrawerOpen: boolean;
  togglePlanDrawer: () => void;
  activePlanId: string | null;
  setActivePlanId: (id: string | null) => void;
  activePlanTitle: string | null;
  setActivePlanTitle: (title: string | null) => void;
  pendingChatMessage: string | null;
  sendChatMessage: (msg: string) => void;
  consumePendingChatMessage: () => string | null;
  /** Right sidebar: which plan is expanded in the Today-mode plan navigator */
  rightSidebarExpandedPlanId: string | null;
  setRightSidebarExpandedPlanId: (id: string | null) => void;
  /** Currently selected task — opens TaskGuide in right sidebar */
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  /** Whether the Plan Detail overlay is open */
  planDetailOpen: boolean;
  setPlanDetailOpen: (open: boolean) => void;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout must be used within AppLayout");
  return ctx;
}

export { LayoutContext };
