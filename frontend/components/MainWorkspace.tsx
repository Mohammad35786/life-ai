"use client";

import React from "react";
import { useLayout, ViewId } from "./LayoutContext";
import { TodayView } from "./TodayView";

interface MainWorkspaceProps {
  children?: React.ReactNode;
}

const viewOrder: ViewId[] = ["today", "chat"];

export function MainWorkspace({ children }: MainWorkspaceProps) {
  const { activeView } = useLayout();

  return (
    <section className="mainWorkspace">
      {viewOrder.map((viewId) => {
        const isActive = activeView === viewId;
        return (
          <div
            key={viewId}
            className={isActive ? "mainWorkspaceView mainWorkspaceViewActive" : "mainWorkspaceView"}
            aria-hidden={!isActive}
          >
            {viewId === "chat" && children}
            {viewId === "today" && <TodayView />}
          </div>
        );
      })}
    </section>
  );
}
