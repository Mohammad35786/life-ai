"use client";

import React, { useMemo, useState, useCallback } from "react";
import { LayoutContext, LayoutContextValue, OverlayItem } from "./LayoutContext";
import { LeftSidebar } from "./LeftSidebar";
import { MainWorkspace } from "./MainWorkspace";
import { RightSidebar } from "./RightSidebar";
import { OverlayLayer } from "./OverlayLayer";
import { PlansDrawer } from "./PlansDrawer";

// Re-export for convenience
export { useLayout } from "./LayoutContext";
export type { ViewId } from "./LayoutContext";

// ── AppLayout ──
interface AppLayoutProps {
  children?: React.ReactNode;
  user?: any;
  onSignOut?: () => void;
  onNewChat?: () => void;
}

export function AppLayout({ children, user, onSignOut, onNewChat }: AppLayoutProps) {
  const [activeView, setActiveView] = useState<LayoutContextValue["activeView"]>("today");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [todayRefreshKey, setTodayRefreshKey] = useState(0);
  const [conversationsRefreshKey, setConversationsRefreshKey] = useState(0);
  const [conversationToLoad, setConversationToLoad] = useState<string | null>(null);
  const [isPlanDrawerOpen, setIsPlanDrawerOpen] = useState(false);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activePlanTitle, setActivePlanTitle] = useState<string | null>(null);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  const [rightSidebarExpandedPlanId, setRightSidebarExpandedPlanId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [planDetailOpen, setPlanDetailOpen] = useState(false);

  const refreshToday = useCallback(() => setTodayRefreshKey((k) => k + 1), []);
  const refreshConversations = useCallback(() => setConversationsRefreshKey((k) => k + 1), []);
  const loadConversation = useCallback((id: string) => setConversationToLoad(id), []);
  const clearConversationToLoad = useCallback(() => setConversationToLoad(null), []);
  const togglePlanDrawer = useCallback(() => setIsPlanDrawerOpen((v) => !v), []);
  const sendChatMessage = useCallback((msg: string) => setPendingChatMessage(msg), []);
  const consumePendingChatMessage = useCallback(() => {
    const msg = pendingChatMessage;
    setPendingChatMessage(null);
    return msg;
  }, [pendingChatMessage]);

  const pushOverlay = useCallback((item: OverlayItem) => {
    setOverlays((prev) => [...prev, item]);
  }, []);

  const popOverlay = useCallback((id?: string) => {
    if (id) {
      setOverlays((prev) => prev.filter((o) => o.id !== id));
    } else {
      setOverlays((prev) => prev.slice(0, -1));
    }
  }, []);

  const contextValue: LayoutContextValue = useMemo(() => ({
    activeView,
    setActiveView,
    rightPanelOpen,
    setRightPanelOpen,
    pushOverlay,
    popOverlay,
    todayRefreshKey,
    refreshToday,
    conversationsRefreshKey,
    refreshConversations,
    conversationToLoad,
    loadConversation,
    clearConversationToLoad,
    isPlanDrawerOpen,
    togglePlanDrawer,
    activePlanId,
    setActivePlanId,
    activePlanTitle,
    setActivePlanTitle,
    pendingChatMessage,
    sendChatMessage,
    consumePendingChatMessage,
    rightSidebarExpandedPlanId,
    setRightSidebarExpandedPlanId,
    selectedTaskId,
    setSelectedTaskId,
    planDetailOpen,
    setPlanDetailOpen,
  }), [
    activeView, rightPanelOpen, todayRefreshKey, conversationsRefreshKey,
    conversationToLoad, isPlanDrawerOpen, activePlanId, activePlanTitle,
    pendingChatMessage, rightSidebarExpandedPlanId, selectedTaskId, planDetailOpen,
    pushOverlay, popOverlay, refreshToday, refreshConversations, loadConversation,
    clearConversationToLoad, togglePlanDrawer, sendChatMessage, consumePendingChatMessage,
  ]);

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className="appLayout">
        <LeftSidebar user={user} onSignOut={onSignOut} onNewChat={onNewChat} />
        <MainWorkspace>{children}</MainWorkspace>
        <RightSidebar />
        <OverlayLayer overlays={overlays} onDismiss={popOverlay} />
        <PlansDrawer />
      </div>
    </LayoutContext.Provider>
  );
}
