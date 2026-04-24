"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconSend, IconToday, IconChevronDown, IconSettings, IconUser, IconLogout, IconHistory, IconMore } from "./icons";
import { useLayout, ViewId } from "./LayoutContext";
import { apiGet, apiPatch, apiDelete } from "../lib/api";
import { listActivePlans, deletePlan, patchPlan, type PlanResponse } from "../lib/adaptive";
import { getPlanColor } from "../lib/planColors";

interface LeftSidebarProps {
  user?: any;
  onSignOut?: () => void;
  onNewChat?: () => void;
}

type ConversationSummary = {
  id: string;
  title: string;
  preview?: string;
  message_count?: number;
  archived?: boolean;
  updated_at?: string;
};

type NavItem = {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
};

const navItems: NavItem[] = [
  { id: "today", label: "Today", icon: <IconToday /> },
  { id: "chat", label: "Chat", icon: <IconSend /> },
];

export function LeftSidebar({ user, onSignOut, onNewChat }: LeftSidebarProps) {
  const { activeView, setActiveView, loadConversation, conversationsRefreshKey, setRightSidebarExpandedPlanId, refreshToday } = useLayout();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [contextMenuConvId, setContextMenuConvId] = useState<string | null>(null);
  const [contextMenuPlanId, setContextMenuPlanId] = useState<string | null>(null);
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [planRenameDraft, setPlanRenameDraft] = useState("");
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const planContextMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch conversation history
  const fetchConversations = useCallback(() => {
    if (!user) return;
    apiGet<ConversationSummary[]>("/api/conversations")
      .then((data) => setConversations(data.filter((c) => !c.archived)))
      .catch((err: unknown) => console.error("Failed to load history:", err));
  }, [user]);

  useEffect(() => { fetchConversations(); }, [fetchConversations, conversationsRefreshKey]);

  // Fetch active plans for the sidebar list — only on mount and refresh, not on activeView change
  useEffect(() => {
    listActivePlans().then(setPlans).catch(console.error);
  }, [conversationsRefreshKey]);

  const handlePlanClick = (planId: string) => {
    if (contextMenuPlanId) return;
    setActiveView("today");
    setRightSidebarExpandedPlanId(planId);
  };

  const handlePlanContextMenu = (e: React.MouseEvent, planId: string) => {
    e.stopPropagation();
    setContextMenuPlanId(contextMenuPlanId === planId ? null : planId);
  };

  const handlePlanDelete = async (planId: string) => {
    setContextMenuPlanId(null);
    try {
      await deletePlan(planId);
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      refreshToday();
    } catch (err) {
      console.error("Failed to delete plan:", err);
    }
  };

  const handlePlanRename = (planId: string) => {
    setContextMenuPlanId(null);
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setRenamingPlanId(planId);
    setPlanRenameDraft(plan.title ?? "");
  };

  const handlePlanRenameSubmit = async (planId: string) => {
    const newTitle = planRenameDraft.trim();
    if (!newTitle) { setRenamingPlanId(null); setPlanRenameDraft(""); return; }
    try {
      await patchPlan(planId, { title: newTitle });
      setPlans((prev) => prev.map((p) => p.id === planId ? { ...p, title: newTitle } : p));
      refreshToday();
    } catch (err) {
      console.error("Failed to rename plan:", err);
    }
    setRenamingPlanId(null);
    setPlanRenameDraft("");
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (contextMenuConvId && contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuConvId(null);
      }
      if (contextMenuPlanId && planContextMenuRef.current && !planContextMenuRef.current.contains(e.target as Node)) {
        setContextMenuPlanId(null);
      }
    };
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setUserMenuOpen(false);
        setContextMenuConvId(null);
        if (renamingConvId) { setRenamingConvId(null); setRenameDraft(""); }
        if (renamingPlanId) { setRenamingPlanId(null); setPlanRenameDraft(""); }
        setContextMenuPlanId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [userMenuOpen, contextMenuConvId, contextMenuPlanId, renamingConvId, renamingPlanId]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingConvId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
    if (renamingPlanId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingConvId, renamingPlanId]);

  const handleNavClick = (viewId: ViewId) => {
    if (viewId === "chat" && onNewChat) onNewChat();
    setActiveView(viewId);
  };

  const handleHistoryClick = (convId: string) => {
    if (renamingConvId) return;
    setContextMenuConvId(null);
    setActiveView("chat");
    loadConversation(convId);
  };

  const handleContextMenu = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setContextMenuConvId(contextMenuConvId === convId ? null : convId);
  };

  const handleRename = async (convId: string) => {
    setContextMenuConvId(null);
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    setRenamingConvId(convId);
    setRenameDraft(conv.title);
  };

  const handleRenameSubmit = async (convId: string) => {
    const newTitle = renameDraft.trim();
    if (!newTitle) { setRenamingConvId(null); setRenameDraft(""); return; }
    try {
      await apiPatch(`/api/conversations/${convId}`, { title: newTitle });
      setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, title: newTitle } : c));
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    }
    setRenamingConvId(null);
    setRenameDraft("");
  };

  const handleArchive = async (convId: string) => {
    setContextMenuConvId(null);
    try {
      await apiPatch(`/api/conversations/${convId}`, { archived: true });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
    } catch (err) {
      console.error("Failed to archive conversation:", err);
    }
  };

  const handleDelete = async (convId: string) => {
    setContextMenuConvId(null);
    try {
      await apiDelete(`/api/conversations/${convId}`);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  // Group conversations by date
  const groupedConversations = (() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const groups: { label: string; items: ConversationSummary[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Previous 7 days", items: [] },
      { label: "Older", items: [] },
    ];

    for (const conv of conversations) {
      const updated = conv.updated_at ? new Date(conv.updated_at) : now;
      const dateOnly = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate());
      if (dateOnly.getTime() >= today.getTime()) groups[0].items.push(conv);
      else if (dateOnly.getTime() >= yesterday.getTime()) groups[1].items.push(conv);
      else if (dateOnly.getTime() >= weekAgo.getTime()) groups[2].items.push(conv);
      else groups[3].items.push(conv);
    }

    return groups.filter((g) => g.items.length > 0);
  })();

  return (
    <aside className="leftSidebar" aria-label="Navigation">
      {/* Brand */}
      <div className="leftSidebarBrand">
        <div className="leftSidebarLogoIcon">AI</div>
        <div className="leftSidebarBrandText">
          <div className="leftSidebarCompanyName">Life Agent</div>
          <div className="leftSidebarSubtitle">by getplan.to</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="leftSidebarNav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? "leftSidebarNavItem leftSidebarNavItemActive" : "leftSidebarNavItem"}
            type="button"
            onClick={() => handleNavClick(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span className="leftSidebarNavIcon">{item.icon}</span>
            <span className="leftSidebarNavLabel">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Active Plans section */}
      {plans.length > 0 && (
        <div className="leftSidebarPlans">
          <div className="leftSidebarPlansLabel">Active plans</div>
          {plans.map((plan, i) => (
            <div key={plan.id} className="leftSidebarPlanItemWrap" ref={contextMenuPlanId === plan.id ? planContextMenuRef : undefined}>
              {renamingPlanId === plan.id ? (
                <div className="leftSidebarPlanItemRename">
                  <input
                    ref={renameInputRef}
                    className="leftSidebarPlanRenameInput"
                    value={planRenameDraft}
                    onChange={(e) => setPlanRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handlePlanRenameSubmit(plan.id);
                      if (e.key === "Escape") { setRenamingPlanId(null); setPlanRenameDraft(""); }
                    }}
                    onBlur={() => handlePlanRenameSubmit(plan.id)}
                  />
                </div>
              ) : (
                <button
                  className="leftSidebarPlanItem"
                  type="button"
                  onClick={() => handlePlanClick(plan.id)}
                  title={plan.title ?? "Untitled Plan"}
                >
                  <span className="leftSidebarPlanDot" style={{ background: getPlanColor(i) }} />
                  <span className="leftSidebarPlanName">{plan.title ?? "Untitled"}</span>
                  <span
                    className="leftSidebarPlanItemMore"
                    role="button"
                    onClick={(e) => handlePlanContextMenu(e, plan.id)}
                    title="Options"
                  >
                    <IconMore />
                  </span>
                </button>
              )}
              {contextMenuPlanId === plan.id && (
                <div className="leftSidebarPlanContextMenu" role="menu">
                  <button className="leftSidebarPlanContextItem" role="menuitem" type="button" onClick={() => handlePlanRename(plan.id)}>
                    Rename
                  </button>
                  <div className="leftSidebarPlanContextDivider" />
                  <button className="leftSidebarPlanContextItem leftSidebarPlanContextItemDanger" role="menuitem" type="button" onClick={() => handlePlanDelete(plan.id)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* History section */}
      <div className="leftSidebarHistory">
        <button
          className="leftSidebarHistoryToggle"
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          aria-expanded={historyOpen}
        >
          <span className="leftSidebarHistoryToggleIcon">
            <IconHistory />
          </span>
          <span className="leftSidebarHistoryToggleLabel">History</span>
          <span className="leftSidebarHistoryChevron">
            <IconChevronDown rotated={historyOpen} />
          </span>
        </button>

        {historyOpen && (
          <div className="leftSidebarHistoryList">
            {conversations.length === 0 && (
              <p className="leftSidebarHistoryEmpty">No conversations yet</p>
            )}
            {groupedConversations.map((group) => (
              <div key={group.label}>
                <div className="leftSidebarHistoryGroupLabel">{group.label}</div>
                {group.items.map((conv) => (
                  <div key={conv.id} className="leftSidebarHistoryItemWrap" ref={contextMenuConvId === conv.id ? contextMenuRef : undefined}>
                    {renamingConvId === conv.id ? (
                      <div className="leftSidebarHistoryItemRename">
                        <input
                          ref={renameInputRef}
                          className="leftSidebarHistoryRenameInput"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSubmit(conv.id);
                            if (e.key === "Escape") { setRenamingConvId(null); setRenameDraft(""); }
                          }}
                          onBlur={() => handleRenameSubmit(conv.id)}
                        />
                      </div>
                    ) : (
                      <button
                        className="leftSidebarHistoryItem"
                        type="button"
                        onClick={() => handleHistoryClick(conv.id)}
                        title={conv.title}
                      >
                        <span className="leftSidebarHistoryItemTitle">{conv.title}</span>
                        <span
                          className="leftSidebarHistoryItemMore"
                          role="button"
                          onClick={(e) => handleContextMenu(e, conv.id)}
                          title="Options"
                        >
                          <IconMore />
                        </span>
                      </button>
                    )}
                    {contextMenuConvId === conv.id && (
                      <div className="leftSidebarHistoryContextMenu" role="menu">
                        <button className="leftSidebarHistoryContextItem" role="menuitem" type="button" onClick={() => handleRename(conv.id)}>
                          Rename
                        </button>
                        <button className="leftSidebarHistoryContextItem" role="menuitem" type="button" onClick={() => handleArchive(conv.id)}>
                          Archive
                        </button>
                        <div className="leftSidebarHistoryContextDivider" />
                        <button className="leftSidebarHistoryContextItem leftSidebarHistoryContextItemDanger" role="menuitem" type="button" onClick={() => handleDelete(conv.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: User section */}
      <div className="leftSidebarFooter">
        <div className="leftSidebarUserWrap" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="leftSidebarUserMenu" role="menu">
              <button className="leftSidebarUserMenuItem" role="menuitem" type="button">
                <span className="leftSidebarUserMenuIcon"><IconUser /></span>
                Account
              </button>
              <button
                className="leftSidebarUserMenuItem"
                role="menuitem"
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                }}
              >
                <span className="leftSidebarUserMenuIcon"><IconSettings /></span>
                Settings
              </button>
              <div className="leftSidebarUserMenuDivider" />
              <button
                className="leftSidebarUserMenuItem leftSidebarUserMenuItemLogout"
                role="menuitem"
                type="button"
                onClick={async () => {
                  setUserMenuOpen(false);
                  onSignOut?.();
                }}
              >
                <span className="leftSidebarUserMenuIcon"><IconLogout /></span>
                Logout
              </button>
            </div>
          )}

          <button
            className="leftSidebarUserSection"
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-haspopup="true"
            aria-expanded={userMenuOpen}
          >
            <div className="userAvatar">{user?.email?.[0].toUpperCase() ?? "U"}</div>
            <div className="userInfo">
              <div className="userName">{user?.email ?? "User"}</div>
              <div className="userStatus">Free Plan</div>
            </div>
            <span className="userMenuChevron">
              <IconChevronDown rotated={userMenuOpen} />
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
