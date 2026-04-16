"use client";

import React, { DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoadmapViewer } from "./RoadmapViewer";
import { OutlineViewer } from "./OutlineViewer";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  isPlan?: boolean;
  originalUserMsg?: string;
  convertedToRoadmap?: boolean;
};

export type RoadmapNode = {
  id: string;
  type: "main" | "module" | "side";
  data: {
    label: string;
    description?: string;
  };
  position: { x: number; y: number };
};

export type RoadmapEdge = {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
};

export type RoadmapOutline = {
  title: string;
  description: string;
  subtopics: string[];
  resources: string[];
  estimatedTime: string;
};

export type RoadmapData = {
  title?: string;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
  outlines?: Record<string, RoadmapOutline>;
};

export const ROADMAP_SYSTEM_PROMPT = `
You are Roadmap.sh Agent. Your ONLY job is to generate visual roadmaps.

User will say something like "Create a full stack developer roadmap".

You MUST respond in EXACTLY this format — nothing else:

First 2-3 sentences of friendly summary.

Then, on a new line, output ONLY this exact JSON (no extra text, no markdown, no explanation):

{
  "title": "Roadmap Title",
  "nodes": [
    { "id": "1", "type": "main", "data": { "label": "...", "description": "..." }, "position": { "x": 0, "y": 0 } }
  ],
  "edges": [
    { "id": "e1-2", "source": "1", "target": "2" }
  ],
  "outlines": {
    "1": {
      "title": "...",
      "description": "...",
      "subtopics": ["...", "..."],
      "resources": ["...", "..."],
      "estimatedTime": "..."
    }
  }
}

Rules:
- Use only "main", "module", or "side" for type.
- Positions must be numbers (x and y between 0 and 2000).
- Never add any text after the final } of the JSON. Make sure you close all brackets.
- The \`outlines\` dictionary MUST contain a rich syllabus entry keyed by EVERY single node \`id\` you generate.
- Make it look exactly like the Claude Code roadmap: main vertical path + side branches.

If you understand, reply with: "Ready to generate roadmaps."
`;

type ParsedGoal = {
  id: string;
  title: string;
  description: string;
};

type PlanTask = {
  id: string;
  plan_id: string;
  title: string;
  due_date: string;
  status: "todo" | "done";
  priority: string;
  parent_id?: string | null;
};

type Plan = {
  id: string;
  goal_id: string;
  tasks: PlanTask[];
  created_at: string;
  textSummary?: string;
  roadmapData?: RoadmapData;
};

type TaskCompletionResponse = {
  success: boolean;
  task: PlanTask;
};


type RoadmapFolder = {
  id: string;
  name: string;
  created_at: string;
};

type RoadmapDocument = {
  id: string;
  folder_id?: string;
  title: string;
  topic: string;
  difficulty: string;
  provider: string;
  data: RoadmapData;
  created_at: string;
};

type PlanView = "today" | "week" | "month";

const ROADMAP_TEMPLATES: Record<string, RoadmapData> = {
  "BCS 1-Year": {
    nodes: [
      { id: "1", type: "main", data: { label: "Foundation", description: "Months 1-3: Gather materials, build habits" }, position: { x: 250, y: 0 } },
      { id: "1a", type: "side", data: { label: "Mental Ability", description: "30 mins daily practice" }, position: { x: 50, y: 30 } },
      { id: "2", type: "main", data: { label: "Core Subjects", description: "Months 4-8: Deep dive into all topics" }, position: { x: 250, y: 150 } },
      { id: "2a", type: "side", data: { label: "Bangladesh Affairs", description: "Focus heavily & take notes" }, position: { x: 450, y: 180 } },
      { id: "3", type: "main", data: { label: "Mock Tests & Revision", description: "Months 9-12: Full length mocks" }, position: { x: 250, y: 300 } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2" },
      { id: "e1-1a", source: "1", target: "1a", animated: true },
      { id: "e2-3", source: "2", target: "3" },
      { id: "e2-2a", source: "2", target: "2a", animated: true },
    ]
  },
  "BCS 6-Month": {
    nodes: [
      { id: "1", type: "main", data: { label: "Rapid Review", description: "Months 1-2: Skim all topics quickly" }, position: { x: 250, y: 0 } },
      { id: "2", type: "main", data: { label: "Intensive Practice", description: "Months 3-4: Question banks only" }, position: { x: 250, y: 150 } },
      { id: "3", type: "main", data: { label: "Final Mocks", description: "Months 5-6: Daily mock tests" }, position: { x: 250, y: 300 } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2", animated: true },
      { id: "e2-3", source: "2", target: "3", animated: true },
    ]
  },
  "Morning Routine": {
    nodes: [
      { id: "1", type: "main", data: { label: "Wake Up (6:00 AM)", description: "Drink water, stretch immediately" }, position: { x: 250, y: 0 } },
      { id: "2", type: "main", data: { label: "Exercise (6:15 AM)", description: "30 mins cardio or yoga" }, position: { x: 250, y: 150 } },
      { id: "2a", type: "side", data: { label: "Podcast", description: "Listen while exercising" }, position: { x: 450, y: 180 } },
      { id: "3", type: "main", data: { label: "Deep Work (7:00 AM)", description: "90 mins of uninterrupted study" }, position: { x: 250, y: 300 } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2" },
      { id: "e2-3", source: "2", target: "3" },
      { id: "e2-2a", source: "2", target: "2a", animated: true },
    ]
  }
};

const initialMessages: ChatMessage[] = [];
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const activeGoalStorageKey = "life-agent-active-goal";
const activePlanStorageKey = "life-agent-active-plan";


type GuidedEntryTabConfig = {
  id: "career" | "job" | "learn" | "test";
  label: string;
  questions: string[];
};

const guidedEntryTabs: GuidedEntryTabConfig[] = [
  {
    id: "career",
    label: "Help select a career path",
    questions: [
      "What career suits my skills?",
      "How do I choose between multiple career options?",
      "What skills should I learn for future jobs?",
      "Suggest a roadmap based on my interests",
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
      "Create a roadmap to learn [topic]",
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

type GuidedEntryTabId = GuidedEntryTabConfig["id"];

/** Detect if an AI message looks like a plan (numbered steps, phases, etc.) */
function isPlanLike(content: string): boolean {
  if (!content || content.length < 40) return false;
  // Must have at least 2 numbered items to count as a plan list
  const numberedItems = content.match(/(?:^|\n)\s*\d+[.)]\s/g) || [];
  const hasNumberedList = numberedItems.length >= 2;
  const hasPlanKeywords = /\b(?:step|phase|stage|week \d|month \d|day \d|roadmap|syllabus|curriculum|schedule|milestone)\b/i.test(content);
  const hasMultipleLines = (content.match(/\n/g) || []).length >= 3;
  return hasNumberedList || (hasPlanKeywords && hasMultipleLines);
}

/* ── Inline SVG icons (no external dependency) ──────────────── */
function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconBookmark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconPanelLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconDotsH() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconChevronDown({ rotated }: { rotated?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: "transform 0.2s ease", transform: rotated ? "rotate(-180deg)" : "rotate(0deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconLayoutGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconDeepSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8a3 3 0 0 1 3 3" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconTodo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconRoutine() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconMortarboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
    </svg>
  );
}

function IconDumbbell() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 6.5h11M6.5 17.5h11" />
      <path d="M3 10h18M3 14h18" />
      <rect x="1" y="9" width="4" height="6" rx="1" />
      <rect x="19" y="9" width="4" height="6" rx="1" />
    </svg>
  );
}

function IconBriefcase() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <line x1="12" y1="12" x2="12" y2="12" />
    </svg>
  );
}

function IconRocket() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function IconPencilRuler() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 5 4 4" />
      <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
      <path d="m8 6 2-2" />
      <path d="m2 22 5.5-1.5L21 7a2.12 2.12 0 0 0-3-3L4.5 17.5 2 22" />
      <path d="m18 16 2-2" />
      <path d="m17 11 4.3 4.3a2.41 2.41 0 0 1 0 3.4l-2.6 2.6a2.41 2.41 0 0 1-3.4 0L11 17" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconClipboardList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <line x1="8" y1="11" x2="8" y2="11" />
      <line x1="11" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="8" y2="15" />
      <line x1="11" y1="15" x2="16" y2="15" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function IconClockSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────── */

/* ── Hierarchical Plan Roadmap View ─────────────────────────── */
type RoadmapMonth = {
  key: string;           // "2025-04"
  label: string;         // "April 2025"
  weeks: RoadmapWeek[];
};

type RoadmapWeek = {
  key: string;           // "2025-W14"
  label: string;         // "Week 14"
  days: RoadmapDay[];
};

type RoadmapDay = {
  key: string;           // "2025-04-07"
  label: string;         // "Mon, Apr 7"
  tasks: PlanTask[];
};

function getISOWeek(date: Date): number {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Build a calendar skeleton for monthOffset months relative to today.
 *  Tasks are merged in — days with no tasks show an empty slot.
 *  monthOffsets: array like [-1, 0, 1] = prev, current, next */
function buildCalendarRoadmap(tasks: PlanTask[], monthOffsets: number[]): RoadmapMonth[] {
  // Index tasks by due_date for O(1) lookup
  const tasksByDay = new Map<string, PlanTask[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    if (!tasksByDay.has(t.due_date)) tasksByDay.set(t.due_date, []);
    tasksByDay.get(t.due_date)!.push(t);
  }

  // Also collect any task months that exceed our window so we don't lose tasks
  const extraMonthKeys = new Set<string>();
  for (const key of tasksByDay.keys()) {
    const d = new Date(key + "T00:00:00");
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    extraMonthKeys.add(mk);
  }

  const now = new Date();
  const monthKeySet = new Set<string>();

  // Window months
  for (const offset of monthOffsets) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    monthKeySet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  // Task months outside window
  for (const mk of extraMonthKeys) monthKeySet.add(mk);

  const sortedMonthKeys = [...monthKeySet].sort();
  const months: RoadmapMonth[] = [];

  for (const monthKey of sortedMonthKeys) {
    const [yr, mo] = monthKey.split("-").map(Number);
    const monthLabel = new Date(yr, mo - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });

    // Build all days in the month
    const firstDay = new Date(yr, mo - 1, 1);
    const lastDay = new Date(yr, mo, 0);

    // Group days into ISO weeks
    const weekMap = new Map<string, RoadmapDay[]>();
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const dayKey = toDateKey(d);
      const wNum = getISOWeek(d);
      // Week key uses the year the week belongs to (for week 1 in Jan)
      const wYr = d.getMonth() === 0 && wNum > 50 ? d.getFullYear() - 1
        : d.getMonth() === 11 && wNum < 5 ? d.getFullYear() + 1
          : d.getFullYear();
      const weekKey = `${wYr}-W${String(wNum).padStart(2, "0")}`;
      const lbl = new Date(d).toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
      const dayTasks = tasksByDay.get(dayKey) ?? [];

      if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
      weekMap.get(weekKey)!.push({ key: dayKey, label: lbl, tasks: dayTasks });
    }

    const weeks: RoadmapWeek[] = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, days]) => ({
        key: weekKey,
        label: `Week ${parseInt(weekKey.split("W")[1], 10)}`,
        days,
      }));

    months.push({ key: monthKey, label: monthLabel, weeks });
  }

  return months;
}

function PlanRoadmapView({ tasks, onCompleteTask, pendingTaskIds, onAddTask }: {
  tasks: PlanTask[];
  onCompleteTask: (id: string) => void;
  pendingTaskIds: string[];
  onAddTask: (date: string, title: string, parentId?: string) => Promise<void>;
}) {
  // Always show prev month, current month, and next month + any months that have tasks
  const roadmap = buildCalendarRoadmap(tasks, [-1, 0, 1, 2]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const curWeekNum = getISOWeek(now);
  const curWeekKey = `${now.getFullYear()}-W${String(curWeekNum).padStart(2, "0")}`;

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => {
    const allWeekKeys = roadmap.flatMap(m => m.weeks.map(w => w.key));
    return new Set(allWeekKeys);
  });
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => {
    const allDayKeys = roadmap.flatMap(m => m.weeks.flatMap(w => w.days.map(d => d.key)));
    return new Set(allDayKeys);
  });

  const [addingTaskForDay, setAddingTaskForDay] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingSubtaskForTask, setAddingSubtaskForTask] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const handleSubmitTask = async (dateKey: string) => {
    if (!newTaskTitle.trim() || isSubmittingTask) return;
    setIsSubmittingTask(true);
    try {
      await onAddTask(dateKey, newTaskTitle.trim());
      setNewTaskTitle("");
      setAddingTaskForDay(null);
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const handleSubmitSubtask = async (dateKey: string, parentId: string) => {
    if (!newSubtaskTitle.trim() || isSubmittingTask) return;
    setIsSubmittingTask(true);
    try {
      await onAddTask(dateKey, newSubtaskTitle.trim(), parentId);
      setNewSubtaskTitle("");
      setAddingSubtaskForTask(null);
    } finally {
      setIsSubmittingTask(false);
    }
  };

  useEffect(() => {
    // Small delay to ensure DOM is settled after expansion
    const timer = setTimeout(() => {
      if (boardRef.current) {
        const currentElement = boardRef.current.querySelector(".roadmapWeekCurrent");
        if (currentElement instanceof HTMLElement) {
          const board = boardRef.current;
          const offsetLeft = currentElement.offsetLeft;
          const width = currentElement.offsetWidth;
          const boardWidth = board.offsetWidth;

          board.scrollTo({
            left: offsetLeft - boardWidth / 2 + width / 2,
            behavior: "instant",
          });
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const totalDone = tasks.filter(t => t.status === "done").length;
  const totalTasks = tasks.length;
  const pct = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

  // Fixed week column width + gap (must match CSS)
  const WEEK_W = 250;
  const WEEK_GAP = 20;

  return (
    <div className="roadmapRoot" style={{ '--week-w': `${WEEK_W}px`, '--week-gap': `${WEEK_GAP}px` } as React.CSSProperties}>
      {/* Overall progress — always shown */}
      <div className="roadmapOverallProgress">
        <div className="roadmapProgressRow">
          <span className="roadmapProgressLabel">
            {totalTasks > 0 ? `${totalDone}/${totalTasks} tasks complete` : "No tasks yet — your plan will fill in here"}
          </span>
          {totalTasks > 0 && <span className="roadmapProgressPct">{pct}%</span>}
        </div>
        <div className="roadmapProgressTrack">
          <div className="roadmapProgressFill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Timeline board: single horizontal scroll container */}
      <div className="roadmapBoard" ref={boardRef}>

        {/* Row 1: thin month label strip — each label spans its weeks */}
        <div className="roadmapMonthStrip">
          {roadmap.map((month) => {
            const isCurMonth = month.key === curMonthKey;
            const spanW = month.weeks.length * WEEK_W + (month.weeks.length - 1) * WEEK_GAP;
            return (
              <div
                key={month.key}
                className={isCurMonth ? "roadmapMonthLabel roadmapMonthLabelCurrent" : "roadmapMonthLabel"}
                style={{ width: `${spanW}px` }}
              >
                <span className="roadmapMonthLabelText">{month.label}</span>
                {isCurMonth && <span className="roadmapCurrentBadge">Now</span>}
              </div>
            );
          })}
        </div>

        {/* Row 2: all week columns flat in one scrolling strip */}
        <div className="roadmapWeekStrip">
          {roadmap.flatMap((month) =>
            month.weeks.map((week) => {
              const wOpen = expandedWeeks.has(week.key);
              const wDone = week.days.flatMap(d => d.tasks).filter(t => t.status === "done").length;
              const wTotal = week.days.flatMap(d => d.tasks).length;
              const isCurWeek = week.key === curWeekKey;

              return (
                <div
                  key={`${month.key}-${week.key}`}
                  className={isCurWeek ? "roadmapWeek roadmapWeekCurrent" : "roadmapWeek"}
                >
                  {/* Week header */}
                  <button
                    type="button"
                    className="roadmapWeekHeader"
                    onClick={() => toggle(expandedWeeks, week.key, setExpandedWeeks)}
                    aria-expanded={wOpen}
                  >
                    <span className="roadmapWeekChevron">
                      <IconChevronDown rotated={wOpen} />
                    </span>
                    <span className="roadmapWeekName">
                      {week.label}
                      {isCurWeek && <span className="roadmapCurrentWeekDot" />}
                    </span>
                    <span className="roadmapWeekMeta">
                      {wTotal > 0 ? `${wDone}/${wTotal}` : "—"}
                    </span>
                  </button>

                  {/* Days — always vertical inside the week column */}
                  {wOpen && (
                    <div className="roadmapDayList">
                      {week.days.map((day) => {
                        const dOpen = expandedDays.has(day.key);
                        const isToday = day.key === todayKey;
                        const hasTasks = day.tasks.length > 0;

                        return (
                          <div key={day.key} className={isToday ? "roadmapDay roadmapDayToday" : "roadmapDay"}>
                            <button
                              type="button"
                              className="roadmapDayHeader"
                              onClick={() => toggle(expandedDays, day.key, setExpandedDays)}
                              aria-expanded={dOpen}
                            >
                              <span className="roadmapDayChevron">
                                <IconChevronDown rotated={dOpen} />
                              </span>
                              <span className="roadmapDayName">
                                {day.label}
                                {isToday && <span className="roadmapTodayBadge">Today</span>}
                              </span>
                              {hasTasks && (
                                <span className="roadmapDayMeta">
                                  {day.tasks.filter(t => t.status === "done").length}/{day.tasks.length}
                                </span>
                              )}
                            </button>

                            {dOpen && (() => {
                              const rootTasks = day.tasks.filter(t => !t.parent_id);
                              const tasksByParent = new Map<string, PlanTask[]>();
                              for (const t of day.tasks) {
                                if (t.parent_id) {
                                  if (!tasksByParent.has(t.parent_id)) tasksByParent.set(t.parent_id, []);
                                  tasksByParent.get(t.parent_id)!.push(t);
                                }
                              }

                              const renderTask = (task: PlanTask, isSubtask = false) => {
                                const subtasks = tasksByParent.get(task.id) || [];
                                return (
                                  <React.Fragment key={task.id}>
                                    <div
                                      className={task.status === "done" ? "roadmapTask roadmapTaskDone" : "roadmapTask"}
                                      style={{ marginLeft: isSubtask ? "24px" : "0", borderLeft: isSubtask ? "2px solid #e2e8f0" : "" }}
                                    >
                                      <button
                                        type="button"
                                        className={task.status === "done" ? "taskCheckbox taskCheckboxDone" : "taskCheckbox"}
                                        onClick={() => onCompleteTask(task.id)}
                                        disabled={task.status === "done" || pendingTaskIds.includes(task.id)}
                                        aria-label={task.status === "done" ? "Task completed" : "Mark done"}
                                      >
                                        {task.status === "done" ? "✓" : pendingTaskIds.includes(task.id) ? "…" : ""}
                                      </button>
                                      <div className="roadmapTaskContent">
                                        <span className={task.status === "done" ? "roadmapTaskTitle roadmapTaskTitleDone" : "roadmapTaskTitle"}>
                                          {task.title}
                                        </span>
                                        <span className="roadmapTaskPriority">{task.priority}</span>
                                      </div>
                                      {!isSubtask && (
                                        <button 
                                          type="button" 
                                          onClick={() => setAddingSubtaskForTask(task.id)} 
                                          style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', whiteSpace: 'nowrap' }}
                                        >
                                          + Subtask
                                        </button>
                                      )}
                                    </div>
                                    {addingSubtaskForTask === task.id && (
                                      <div style={{ marginLeft: "24px", display: "flex", gap: "8px", padding: "8px 12px", borderLeft: "2px solid #e2e8f0" }}>
                                        <input 
                                          type="text" autoFocus value={newSubtaskTitle} 
                                          onChange={e => setNewSubtaskTitle(e.target.value)} 
                                          onKeyDown={e => e.key === 'Enter' && handleSubmitSubtask(day.key, task.id)} 
                                          placeholder="New subtask..." 
                                          style={{ flexGrow: 1, padding: "4px 8px", fontSize: "12px", border: "1px solid #cbd5e1", borderRadius: "4px" }} 
                                        />
                                        <button onClick={() => handleSubmitSubtask(day.key, task.id)} disabled={isSubmittingTask} style={{ background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>Save</button>
                                        <button onClick={() => { setAddingSubtaskForTask(null); setNewSubtaskTitle(""); }} style={{ background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                                      </div>
                                    )}
                                    {subtasks.map(st => renderTask(st, true))}
                                  </React.Fragment>
                                );
                              };

                              return (
                                <div className="roadmapTaskList" style={{ paddingBottom: 0 }}>
                                  {rootTasks.length > 0 ? (
                                    rootTasks.map((task) => renderTask(task, false))
                                  ) : (
                                    <div className="roadmapDayEmpty">
                                      <span>No tasks scheduled</span>
                                    </div>
                                  )}
                                  
                                  {addingTaskForDay === day.key ? (
                                    <div style={{ display: "flex", gap: "8px", padding: "8px 12px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" }}>
                                      <input 
                                        type="text" autoFocus value={newTaskTitle} 
                                        onChange={e => setNewTaskTitle(e.target.value)} 
                                        onKeyDown={e => e.key === 'Enter' && handleSubmitTask(day.key)} 
                                        placeholder="New task..." 
                                        style={{ flexGrow: 1, padding: "6px 8px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "4px" }} 
                                      />
                                      <button onClick={() => handleSubmitTask(day.key)} disabled={isSubmittingTask} style={{ background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}>Save</button>
                                      <button onClick={() => { setAddingTaskForDay(null); setNewTaskTitle(""); }} style={{ background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                                    </div>
                                  ) : (
                                    <div style={{ padding: "8px 12px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" }}>
                                      <button 
                                        type="button" 
                                        onClick={() => setAddingTaskForDay(day.key)} 
                                        style={{ fontSize: '12px', color: '#0ea5e9', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                                      >
                                        + Add Task
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}





type GuidedEntryPanelProps = {
  activeTab: GuidedEntryTabId;
  disabled: boolean;
  onQuestionSelect: (question: string) => void;
  onTabChange: (tabId: GuidedEntryTabId) => void;
};

function GuidedEntryPanel({
  activeTab,
  disabled,
  onQuestionSelect,
  onTabChange,
}: GuidedEntryPanelProps) {
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

import { useAuth } from "../lib/auth-context";

export function ChatWindow() {
  const { user, signOut } = useAuth();
  
  const DEFAULT_PLAN_PANEL_WIDTH = 380;
  const MIN_PLAN_PANEL_WIDTH = 320;
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<GuidedEntryTabId>(guidedEntryTabs[0].id);
  
  // Fetch history on mount
  useEffect(() => {
    if (!user) return;
    requestJson<any[]>("/api/conversations", "GET")
      .then((data) => setConversationHistory(data))
      .catch((err) => console.error("Failed to load history:", err));
  }, [user]);
  const [isPlanPanelOpen, setIsPlanPanelOpen] = useState(true);
  const [isPlanPanelExpanded, setIsPlanPanelExpanded] = useState(false);
  const [expandedPanelTab, setExpandedPanelTab] = useState<"yourplan" | "roadmaps" | "progress">("yourplan");
  const [planPanelWidth, setPlanPanelWidth] = useState<number>(DEFAULT_PLAN_PANEL_WIDTH);
  const [mounted, setMounted] = useState(false);
  const [isPlanPanelResizing, setIsPlanPanelResizing] = useState(false);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [activeGoal, setActiveGoal] = useState<ParsedGoal | null>(null);
  const [planView, setPlanView] = useState<PlanView>("today");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isAdjustingPlan, setIsAdjustingPlan] = useState(false);
  const [isConvertingToRoadmap, setIsConvertingToRoadmap] = useState(false);

  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const plusMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const [hasLoadedSnapshot, setHasLoadedSnapshot] = useState(false);

  // Roadmap Generator State
  const [showGeneratorForm, setShowGeneratorForm] = useState(false);
  const [generatorTopic, setGeneratorTopic] = useState("");
  const [generatorDifficulty, setGeneratorDifficulty] = useState("beginner");
  const [generatorProvider, setGeneratorProvider] = useState("default");
  const [isGeneratingRoadmap, setIsGeneratingRoadmap] = useState(false);
  const [roadmapViewMode, setRoadmapViewMode] = useState<"map" | "outline">("map");

  // Schedule Modal State (Add to My Plan)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleWeeks, setScheduleWeeks] = useState(8);
  const [scheduleStudyDays, setScheduleStudyDays] = useState<string[]>(["monday", "wednesday", "friday"]);
  const [isScheduling, setIsScheduling] = useState(false);

  // Folder & Roadmap Persistence State
  const [roadmapFolders, setRoadmapFolders] = useState<RoadmapFolder[]>([]);
  const [savedRoadmaps, setSavedRoadmaps] = useState<RoadmapDocument[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isFetchingRoadmaps, setIsFetchingRoadmaps] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false); // ≤960px
  const [maxPlanPanelWidth, setMaxPlanPanelWidth] = useState(DEFAULT_PLAN_PANEL_WIDTH);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuTop, setMoreMenuTop] = useState(0);
  const [templatesExpanded, setTemplatesExpanded] = useState(true);
  // activeView drives what the main stage renders
  // 'chat' | 'calendar' | 'deepSearch' | 'todos' | 'routine' | 'settings' | 'template:<name>' | 'conversation:<name>'
  const [activeView, setActiveView] = useState<string>("chat");
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [sidebarPlanExpanded, setSidebarPlanExpanded] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"preference" | "appearance" | "customize" | "data">("preference");
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const getMaxPlanPanelWidth = () => {
    if (typeof window === "undefined") {
      return DEFAULT_PLAN_PANEL_WIDTH;
    }

    const sidebarWidth = isNarrow ? 0 : 256;
    return Math.max(MIN_PLAN_PANEL_WIDTH, window.innerWidth - sidebarWidth);
  };

  // Persist panel width to localStorage when changed
  useEffect(() => {
    localStorage.setItem("life-agent-panel-width", planPanelWidth.toString());
  }, [planPanelWidth]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /* Load persisted state */
  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);
    try {
      const storedGoal = window.localStorage.getItem(activeGoalStorageKey);
      const storedPlan = window.localStorage.getItem(activePlanStorageKey);
      const savedWidth = window.localStorage.getItem("life-agent-panel-width");

      if (storedGoal) setActiveGoal(JSON.parse(storedGoal) as ParsedGoal);
      if (storedPlan) {
        setActivePlan(JSON.parse(storedPlan) as Plan);
        setIsPlanPanelOpen(true);
      }
      if (savedWidth) {
        setPlanPanelWidth(Math.max(MIN_PLAN_PANEL_WIDTH, Math.min(parseInt(savedWidth, 10), window.innerWidth)));
      }

    } catch {
      window.localStorage.removeItem(activeGoalStorageKey);
      window.localStorage.removeItem(activePlanStorageKey);
    } finally {
      setHasLoadedSnapshot(true);
    }
  }, []);

  /* Fetch Database Roadmaps */
  useEffect(() => {
    if (!hasLoadedSnapshot || typeof window === "undefined") return;

    const fetchDB = async () => {
      try {
        setIsFetchingRoadmaps(true);
        // We will just use native fetch to ensure it grabs the folders directly
        const fRes = await fetch(apiBaseUrl + "/api/roadmaps/folders");
        if (fRes.ok) {
          const fData = await fRes.json();
          if (fData.success) {
            setRoadmapFolders(fData.folders || []);
          }
        }
        const rRes = await fetch(apiBaseUrl + "/api/roadmaps/");
        if (rRes.ok) {
          const rData = await rRes.json();
          if (rData.success) {
            setSavedRoadmaps(rData.roadmaps || []);
          }
        }
      } catch (err) {
        console.error("Failed to load roadmaps from database", err);
      } finally {
        setIsFetchingRoadmaps(false);
      }
    };
    
    void fetchDB();
  }, [hasLoadedSnapshot]);

  /* Persist state */
  useEffect(() => {
    if (!hasLoadedSnapshot || typeof window === "undefined") return;
    if (activeGoal) window.localStorage.setItem(activeGoalStorageKey, JSON.stringify(activeGoal));
    else window.localStorage.removeItem(activeGoalStorageKey);
    if (activePlan) window.localStorage.setItem(activePlanStorageKey, JSON.stringify(activePlan));
    else window.localStorage.removeItem(activePlanStorageKey);
  }, [activeGoal, activePlan, hasLoadedSnapshot]);



  /* Track narrow viewport (drawer mode) */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 960px)");
    setIsNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsNarrow(e.matches);
      if (!e.matches) setDrawerOpen(false); // close drawer on resize to desktop
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /* Sync plan panel bounds with viewport and left sidebar width */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPlanPanelBounds = () => {
      const nextMaxWidth = getMaxPlanPanelWidth();
      setMaxPlanPanelWidth(nextMaxWidth);
      setPlanPanelWidth((currentWidth) => {
        const constrainedWidth = Math.min(Math.max(currentWidth, MIN_PLAN_PANEL_WIDTH), nextMaxWidth);
        return currentWidth === constrainedWidth ? currentWidth : constrainedWidth;
      });
    };

    syncPlanPanelBounds();
    window.addEventListener("resize", syncPlanPanelBounds);
    return () => window.removeEventListener("resize", syncPlanPanelBounds);
  }, [isNarrow]);

  /* Close drawer / more-menu on Escape or outside click */
  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawerOpen) setDrawerOpen(false);
        if (moreMenuOpen) setMoreMenuOpen(false);
        if (plusMenuOpen) setPlusMenuOpen(false);
        if (userMenuOpen) setUserMenuOpen(false);
        if (isSettingsModalOpen) setIsSettingsModalOpen(false);
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
      if (plusMenuOpen && plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node) && plusMenuBtnRef.current && !plusMenuBtnRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [drawerOpen, moreMenuOpen, plusMenuOpen]);

  /* Auto-resize the textarea to fit content */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  /* Resizable plan panel handlers */
  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Don't force collapse immediately; wait to see if we move
    const startX = e.clientX;
    const startWidth = planPanelWidth;
    let hasMoved = false;

    setIsPlanPanelResizing(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      if (Math.abs(deltaX) > 4) {
        if (!hasMoved) {
          // If we were expanded, drop into resizable mode at the current width
          if (isPlanPanelExpanded) {
            setIsPlanPanelExpanded(false);
          }
          hasMoved = true;
        }
      }

      const nextWidth = Math.max(MIN_PLAN_PANEL_WIDTH, startWidth + deltaX);
      setPlanPanelWidth(Math.min(nextWidth, getMaxPlanPanelWidth()));
    };

    const handleMouseUp = () => {
      setIsPlanPanelResizing(false);
      // If we didn't move much, treat it as a click toggle
      if (!hasMoved) {
        handleExpandToggle();
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleExpandToggle = () => {
    if (isPlanPanelExpanded) {
      setIsPlanPanelExpanded(false);
      setPlanPanelWidth(DEFAULT_PLAN_PANEL_WIDTH);
      return;
    }

    setPlanPanelWidth(getMaxPlanPanelWidth());
    setIsPlanPanelExpanded(true);
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    autoResize(e.target);
  };

  /* Enter sends; Shift+Enter inserts newline */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !isPlanning) {
        e.currentTarget.form?.requestSubmit();
      }
    }
  };

  const submitChatMessage = async (rawContent: string, source: "chat" | "guided" = "chat") => {
    const content = rawContent.trim();
    if (!content) return;

    const systemInstruction = planModeEnabled
      ? ROADMAP_SYSTEM_PROMPT
      : "You are a helpful assistant.\nContinue the conversation naturally.";

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

      const payload: any = {
        message: conversationPrompt,
        source: source
      };

      if (planModeEnabled) {
        // Request JSON mode explicitly for the roadmap
        payload.response_format = { type: "json_object" };
      }

      // Pass source parameter to backend for guided panel inputs
      const res = await requestJson<any>("/api/chat", "POST", payload);

      let replyContent = "";
      if (planModeEnabled) {
        const rawContent = typeof res.reply === "string" ? res.reply : JSON.stringify(res.reply);

        const summaryMatch = rawContent.match(/^([\s\S]*?)(?=\s*\{)/);
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

        let textSummary = summaryMatch ? summaryMatch[1].trim() : rawContent.split('{')[0].trim();
        let roadmapData: RoadmapData | undefined = undefined;

        if (jsonMatch) {
          try {
            roadmapData = JSON.parse(jsonMatch[0]);
          } catch (e) {
            console.error("JSON parse failed:", e);
          }
        }

        if (!roadmapData || !roadmapData.nodes) {
          // fallback
          roadmapData = { nodes: [], edges: [] };
        }

        const finalSummary = textSummary || "Here is your generated plan!";
        replyContent = finalSummary;

        setActivePlan((currentPlan) => {
          if (currentPlan) {
            return {
              ...currentPlan,
              textSummary: finalSummary,
              roadmapData: roadmapData!
            };
          }
          return {
            id: crypto.randomUUID(),
            goal_id: "roadmap-" + Date.now(),
            tasks: [],
            created_at: new Date().toISOString(),
            textSummary: finalSummary,
            roadmapData: roadmapData!
          };
        });

        // Automatically switch to the Roadmaps tab
        setExpandedPanelTab("roadmaps");
        // Ensure plan panel is visible/expanded if it was hidden
        setIsPlanPanelOpen(true);
      } else {
        replyContent = typeof res.reply === "object" ? JSON.stringify(res.reply, null, 2) : res.reply;
      }

      // Detect if this looks like a plan (both chat & guided modes)
      const planDetected = !planModeEnabled && isPlanLike(replyContent);

      const botMsg = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: replyContent,
        isPlan: planDetected || undefined,
        originalUserMsg: planDetected ? content : undefined,
      };

      const updatedMessages = [...currentPlusUser, botMsg];
      setMessages(updatedMessages);
      setPlanModeEnabled(false); // Reset to chat naturally after a plan

      // ── AUTOSAVE TO HISTORY ──────────────────────────────────────────────
      if (user) {
        if (!activeConversationId) {
          // First message: POST /api/conversations
          const title = content.split(" ").slice(0, 6).join(" ") + (content.split(" ").length > 6 ? "..." : "");
          requestJson<any>("/api/conversations", "POST", { title })
            .then(conv => {
              setActiveConversationId(conv.id);
              // Patch immediately with both initial messages
              return requestJson<any>(`/api/conversations/${conv.id}`, "PATCH", { messages: updatedMessages });
            })
            // refresh history list
            .then(() => requestJson<any[]>("/api/conversations", "GET"))
            .then(setConversationHistory)
            .catch(console.error);
        } else {
          // Ongoing chat: PATCH /api/conversations/{id}
          requestJson<any>(`/api/conversations/${activeConversationId}`, "PATCH", { messages: updatedMessages })
            .then(() => requestJson<any[]>("/api/conversations", "GET"))
            .then(setConversationHistory)
            .catch(console.error);
        }
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

  const handleGenerateRoadmap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generatorTopic.trim()) return;

    setIsGeneratingRoadmap(true);
    try {
      const response = await postJson<any>(`/api/roadmaps/generate`, {
        topic: generatorTopic,
        difficulty: generatorDifficulty,
        provider: generatorProvider,
      });

      if (response.success && response.data) {
        // Save to Database persistently
        let newRoadmapDoc: RoadmapDocument | null = null;
        try {
          const dbData = await postJson<any>(`/api/roadmaps/`, {
            folder_id: selectedFolderId || null,
            title: `Roadmap: ${generatorTopic}`,
            topic: generatorTopic,
            difficulty: generatorDifficulty,
            provider: generatorProvider,
            data: response.data
          });
          if (dbData.success && dbData.roadmap) {
             newRoadmapDoc = dbData.roadmap;
             setSavedRoadmaps(prev => [...prev, dbData.roadmap]);
          }
        } catch (dbErr) {
          console.error("Failed saving to DB:", dbErr);
        }

        // Save the roadmap locally into the current active plan for display
        setActivePlan((currentPlan) => {
          const newPlan = currentPlan ? { ...currentPlan } : {
            id: crypto.randomUUID(),
            goal_id: newRoadmapDoc ? newRoadmapDoc.id : "roadmap-" + Date.now(),
            tasks: [],
            created_at: new Date().toISOString(),
          };
          return {
            ...newPlan,
            textSummary: `Roadmap generated for ${generatorTopic}`,
            roadmapData: response.data
          };
        });
        setExpandedPanelTab("roadmaps");
        setShowGeneratorForm(false);
      } else {
        alert("Failed to generate roadmap: " + (response.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Error generating roadmap: " + error.message);
    } finally {
      setIsGeneratingRoadmap(false);
    }
  };

  const handleScheduleSubmit = async () => {
    if (!activePlan?.roadmapData) {
      alert("No roadmap loaded. Generate a roadmap first.");
      return;
    }
    if (scheduleStudyDays.length === 0) {
      alert("Please select at least one study day.");
      return;
    }

    setIsScheduling(true);
    try {
      const response = await postJson<any>("/api/roadmaps/schedule", {
        roadmap_data: activePlan.roadmapData,
        weeks: scheduleWeeks,
        study_days: scheduleStudyDays,
        provider: generatorProvider,
      });

      if (response.success && response.plan) {
        // Preserve the roadmapData so the Roadmaps tab still works
        setActivePlan({
          ...response.plan,
          roadmapData: activePlan.roadmapData,
          textSummary: response.plan.textSummary,
        });
        setExpandedPanelTab("yourplan");
        setIsPlanPanelOpen(true);
        setShowScheduleModal(false);
      } else {
        alert("Failed to create study plan: " + (response.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Error creating study plan: " + error.message);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitChatMessage(draft, "chat");
  };

  const handleConvertToRoadmap = async (message: ChatMessage) => {
    if (isConvertingToRoadmap) return;
    setIsConvertingToRoadmap(true);

    try {
      const response = await postJson<any>("/api/chat/convert-to-roadmap", {
        written_plan: message.content,
        original_message: message.originalUserMsg || "",
        difficulty: "beginner",
        provider: generatorProvider,
        folder_id: selectedFolderId || null,
      });

      if (response.success && response.data) {
        // 1. Add to saved roadmaps list
        if (response.roadmap) {
          setSavedRoadmaps((prev) => [...prev, response.roadmap]);
        }

        // 2. Set as active plan for display
        setActivePlan((currentPlan) => {
          const newPlan = currentPlan ? { ...currentPlan } : {
            id: response.roadmap?.id || crypto.randomUUID(),
            goal_id: "roadmap-" + Date.now(),
            tasks: [],
            created_at: new Date().toISOString(),
          };
          return {
            ...newPlan,
            textSummary: "Roadmap from your plan",
            roadmapData: response.data,
          };
        });

        // 3. Switch to Roadmaps tab & open panel
        setExpandedPanelTab("roadmaps");
        setIsPlanPanelOpen(true);

        // 4. Mark the original plan message as converted (hides buttons)
        setMessages((current) =>
          current.map((m) =>
            m.id === message.id ? { ...m, convertedToRoadmap: true } : m
          )
        );

        // 5. Add a confirmation message in chat
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "✅ Your plan has been converted into a visual roadmap! Check the Roadmaps panel to see it.",
          },
        ]);
      } else {
        // Show error as in-chat message instead of alert
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "⚠️ Failed to convert plan: " + (response.error || "Unknown error") + ". You can try again.",
          },
        ]);
      }
    } catch (error: any) {
      // Show error as in-chat message instead of alert
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "⚠️ Error converting to roadmap: " + error.message + ". You can try again.",
        },
      ]);
    } finally {
      setIsConvertingToRoadmap(false);
    }
  };

  const handleRefinePlan = (message: ChatMessage) => {
    const refinePrompt = `Can you refine this plan? Make it more detailed and actionable:\n\n${message.content}`;
    setDraft(refinePrompt);
    textareaRef.current?.focus();
    if (textareaRef.current) {
      autoResize(textareaRef.current);
    }
  };

  const handleGuidedQuestionSelect = (question: string) => {
    if (isChatLoading || isPlanning) return;
    setDraft(question);
    textareaRef.current?.focus();
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        autoResize(textareaRef.current);
      }
      // Pass source="guided" for guided panel inputs
      void submitChatMessage(question, "guided");
    });
  };

  const visibleTasks = getVisibleTasks(activePlan?.tasks ?? [], planView);

  const handleCompleteTask = async (taskId: string) => {
    if (!activePlan || pendingTaskIds.includes(taskId)) return;
    const currentPlanId = activePlan.id;
    setPendingTaskIds((current: string[]) => [...current, taskId]);

    try {
      const response = await postJson<TaskCompletionResponse>(`/api/tasks/${taskId}/complete`, {});
      setActivePlan((current: Plan | null) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.map((task) => (task.id === response.task.id ? response.task : task)),
        };
      });
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: `Marked "${response.task.title}" as done.` },
      ]);

      try {
        setIsAdjustingPlan(true);
        const adjustedPlan = await postJson<Plan>(`/api/adjust-plan/${currentPlanId}`, {});
        setActivePlan(adjustedPlan);
        setIsPlanPanelOpen(true);
        setMessages((current: ChatMessage[]) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: buildAdjustmentSummary(adjustedPlan) },
        ]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Something went wrong while adjusting the plan.";
        setMessages((current: ChatMessage[]) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `I marked the task as done, but I couldn't adjust the rest of the plan yet. ${detail}`,
          },
        ]);
      } finally {
        setIsAdjustingPlan(false);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Something went wrong while updating the task.";
      setMessages((current: ChatMessage[]) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: `I couldn't mark that task as done yet. ${detail}` },
      ]);
    } finally {
      setPendingTaskIds((current: string[]) => current.filter((id: string) => id !== taskId));
    }
  };

  const handleAddTask = async (date: string, title: string, parentId?: string) => {
    if (!activePlan) return;
    try {
      const payload = {
        title,
        due_date: date,
        status: "todo",
        priority: "medium",
        parent_id: parentId || null
      };
      const response = await postJson<PlanTask>(`/api/plans/${activePlan.id}/tasks`, payload);
      setActivePlan((current: Plan | null) => {
        if (!current) return current;
        return {
          ...current,
          tasks: [...current.tasks, response]
        };
      });
    } catch (e) {
      console.error("Failed to add task", e);
    }
  };

  /* ── Sidebar class ── */
  const sidebarClass = [
    "sidebar",
    // Narrow: drawer open/closed via transform
    isNarrow && drawerOpen ? "sidebarDrawerOpen" : "",
  ].filter(Boolean).join(" ");

  const closeDrawer = () => setDrawerOpen(false);
  const activePlanPanelWidth = isPlanPanelExpanded ? maxPlanPanelWidth : planPanelWidth;
  const mainStageStyle = !isNarrow
    ? { paddingRight: isPlanPanelOpen ? `${activePlanPanelWidth + 24}px` : "0px" }
    : undefined;

  return (
    <>
      <main className="workspaceShell">
        {/* ══════════════════════════════════════════
          LEFT SIDEBAR
      ══════════════════════════════════════════ */}
        {/* Backdrop — shown in drawer mode when open */}
        <div
          className={drawerOpen ? "sidebarBackdrop sidebarBackdropVisible" : "sidebarBackdrop"}
          onClick={closeDrawer}
          aria-hidden="true"
        />

        <aside className={sidebarClass} aria-label="Navigation">
          {/* ── HEADER: Logo + Brand + Motive ── */}
          <div className="sidebarBrandSection">
            <div className="sidebarLogoLarge">
              <div className="sidebarLogoIconLarge" aria-hidden="true">AI</div>
              <div className="sidebarBrandText">
                <div className="sidebarCompanyName">Life Agent</div>
                <div className="sidebarSubtitle">by getplan.to</div>
                <div className="sidebarMotive">Empowering your journey to success</div>
              </div>
            </div>
          </div>

          {/* ── NAVIGATION SECTION ── */}
          <div className="sidebarNavBody">
            {/* Talk with AI */}
            <button
              className={activeView === "chat" ? "sidebarNavItemNew sidebarNavItemNewActive" : "sidebarNavItemNew"}
              type="button"
              id="nav-talk-ai"
              onClick={() => {
                setActiveView("chat");
                setActiveConversationId(null);
                setMessages(initialMessages);
                setIsPlanPanelOpen(false);
                closeDrawer();
              }}
            >
              <div className="sidebarNavItemNewLeft">
                <span className="sidebarNavIconNew"><IconSend /></span>
                <span className="sidebarNavLabelNew">Talk with AI</span>
              </div>
            </button>

            {/* Plan Panel - Expandable */}
            <div className="sidebarNavGroup">
              <button
                className="sidebarNavItemNew sidebarNavExpandableHeader"
                type="button"
                id="nav-plan-panel"
                onClick={() => setSidebarPlanExpanded(!sidebarPlanExpanded)}
                aria-expanded={sidebarPlanExpanded}
              >
                <div className="sidebarNavItemNewLeft">
                  <span className="sidebarNavIconNew"><IconClipboardList /></span>
                  <span className="sidebarNavLabelNew">Plan Panel</span>
                </div>
                <span className="sidebarNavChevron"><IconChevronDown rotated={sidebarPlanExpanded} /></span>
              </button>

              {sidebarPlanExpanded && (
                <div className="sidebarNavSubItems">
                  <button
                    className="sidebarNavSubItem"
                    type="button"
                    id="nav-your-plan"
                    onClick={() => {
                      setIsPlanPanelOpen(true);
                      setIsPlanPanelExpanded(true);
                      setExpandedPanelTab("yourplan");
                      closeDrawer();
                    }}
                  >
                    Your Plan
                  </button>
                  <button
                    className="sidebarNavSubItem"
                    type="button"
                    id="nav-roadmaps"
                    onClick={() => {
                      setIsPlanPanelOpen(true);
                      setIsPlanPanelExpanded(true);
                      setExpandedPanelTab("roadmaps");
                      closeDrawer();
                    }}
                  >
                    Roadmaps
                  </button>
                  <button
                    className="sidebarNavSubItem"
                    type="button"
                    id="nav-progress"
                    onClick={() => {
                      setIsPlanPanelOpen(true);
                      setIsPlanPanelExpanded(true);
                      setExpandedPanelTab("progress");
                      closeDrawer();
                    }}
                  >
                    Progress
                  </button>
                </div>
              )}
            </div>

            {/* Templates/Roadmaps */}
            <button
              className={activeView === "templates" ? "sidebarNavItemNew sidebarNavItemNewActive" : "sidebarNavItemNew"}
              type="button"
              id="nav-templates"
              onClick={() => { setActiveView("templates"); closeDrawer(); }}
            >
              <div className="sidebarNavItemNewLeft">
                <span className="sidebarNavIconNew"><IconLayoutGrid /></span>
                <span className="sidebarNavLabelNew">Templates Roadmaps</span>
              </div>
            </button>

            {/* History */}
            <button
              className={activeView === "history" || activeView.startsWith("conversation:") ? "sidebarNavItemNew sidebarNavItemNewActive" : "sidebarNavItemNew"}
              type="button"
              id="nav-history"
              onClick={() => { setActiveView("history"); closeDrawer(); }}
            >
              <div className="sidebarNavItemNewLeft">
                <span className="sidebarNavIconNew">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </span>
                <span className="sidebarNavLabelNew">History</span>
              </div>
            </button>
          </div>


          {/* ── FOOTER SECTION ── */}
          <div className="sidebarFooterNew">
            {/* Upgrade Box */}
            <div className="upgradeBox">
              <div className="upgradeBoxTop">
                <div className="upgradeBoxIcon">✨</div>
                <div className="upgradeBoxContent">
                  <div className="upgradeTitle">Upgrade to Pro</div>
                  <div className="upgradeDesc">Unlock advanced roadmaps and AI tools.</div>
                </div>
              </div>
              <button className="upgradeBtn">Upgrade Now</button>
            </div>

            {/* User ID Section with Popup Menu */}
            <div className="sidebarUserSectionWrap" ref={userMenuRef}>
              {userMenuOpen && (
                <div className="sidebarUserMenu" role="menu">
                  <button className="sidebarUserMenuItem" role="menuitem" type="button">
                    <span className="sidebarUserMenuIcon"><IconUser /></span>
                    Account
                  </button>
                  <button className="sidebarUserMenuItem" role="menuitem" type="button">
                    <span className="sidebarUserMenuIcon"><IconCreditCard /></span>
                    Billing
                  </button>
                  <button
                    className="sidebarUserMenuItem"
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setIsSettingsModalOpen(true);
                      setUserMenuOpen(false);
                    }}
                  >
                    <span className="sidebarUserMenuIcon"><IconSettings /></span>
                    Settings
                  </button>
                  <div className="sidebarUserMenuDivider" />
                  <button
                    className="sidebarUserMenuItem sidebarUserMenuItemLogout"
                    role="menuitem"
                    type="button"
                    onClick={async () => {
                      await signOut();
                    }}
                  >
                    <span className="sidebarUserMenuIcon"><IconLogout /></span>
                    Logout
                  </button>
                </div>
              )}

              <button
                className="sidebarUserSection"
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
              >
                <div className="userAvatar">{user?.email?.[0].toUpperCase() ?? "U"}</div>
                <div className="userInfo">
                  <div className="userName" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.email ?? "User"}
                  </div>
                  <div className="userStatus">Free Plan</div>
                </div>
                <span className="userMenuChevron">
                  <IconChevronDown rotated={userMenuOpen} />
                </span>
              </button>
            </div>
          </div>
        </aside>

        {/* ══════════════════════════════════════════
          MAIN STAGE
      ══════════════════════════════════════════ */}
        <section className="mainStage" style={mainStageStyle}>
          {!isPlanPanelOpen && (
            <button
              className="floatingYourPlanBtn"
              type="button"
              onClick={() => {
                setIsPlanPanelOpen(true);
                setIsPlanPanelExpanded(false);
                setPlanPanelWidth(DEFAULT_PLAN_PANEL_WIDTH);
              }}
              aria-label="Open planning panel"
              title="Open planning panel"
            >
              <span className="floatingYourPlanBtnIcon"><IconClipboardList /></span>
              Your Plan
            </button>
          )}


          {/* ══════════════════════════════════════════
            RIGHT PLAN DRAWER
        ══════════════════════════════════════════ */}
          {/* Chat region â€” view router */}
          {/*
        <div className="chatRegion">
                      <button
                        className={task.status === "done" ? "drawerTaskCheckbox drawerTaskCheckboxDone" : "drawerTaskCheckbox"}
                        type="button"
                        onClick={() => handleCompleteTask(task.id)}
                        disabled={task.status === "done" || pendingTaskIds.includes(task.id)}
                        aria-label={task.status === "done" ? "Task completed" : "Mark task as completed"}
                      >
                        {task.status === "done" ? "✓" : ""}
                      </button>
                      <div className="drawerTaskContent">
                        <h3 className={task.status === "done" ? "drawerTaskTitle drawerTaskTitleDone" : "drawerTaskTitle"}>
                          {task.title}
                        </h3>
                        <div className="drawerTaskMeta">
                          <span className="drawerTaskTime">
                            <IconClockSmall />
                            {task.priority === "high" ? "30 min" : task.priority === "medium" ? "45 min" : "60 min"}
                          </span>
                          <span className="drawerTaskStatus">{formatStatus(task.status)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                View Full Plan Button
                <button
                  className="viewFullPlanBtn"
                  type="button"
                  onClick={() => setShowPlan(false)}
                >
                  View Full Plan
                  <IconArrowRight />
                </button>
              </>
            ) : (
              <div className="drawerEmptyState">
                <div className="drawerEmptyIcon">📋</div>
                <h3 className="drawerEmptyTitle">No tasks for today</h3>
                <p className="drawerEmptyDesc">
                  {activePlan
                    ? "All your tasks for today are complete. Great job!"
                    : "Start a conversation to create your personalized plan."}
                </p>
              </div>
            )}
          </div>
        </aside>
        */}

          {/* Chat region — view router */}
          <div className="chatRegion">
            {/* ── History View ── */}
            {activeView === "history" && (
              <div style={{ flex: 1, padding: "40px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
                <h2 style={{ fontSize: "24px", color: "#f1f5f9", fontWeight: 700, margin: 0 }}>Conversations</h2>
                {conversationHistory.length === 0 ? (
                  <div style={{ color: "#64748b", marginTop: "20px" }}>No previous conversations found.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {conversationHistory.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={async () => {
                          try {
                            const data = await requestJson<any>(`/api/conversations/${conv.id}`, "GET");
                            setActiveConversationId(data.id);
                            setMessages(data.messages || []);
                            setActiveView("chat");
                          } catch(err) {
                            console.error(err);
                          }
                        }}
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "12px",
                          padding: "16px 20px",
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                      >
                        <div style={{ fontSize: "16px", color: "#e2e8f0", fontWeight: 600, marginBottom: "4px" }}>
                          {conv.title || "Untitled Conversation"}
                        </div>
                        <div style={{ fontSize: "13px", color: "#64748b", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {conv.preview || "No messages yet."}
                        </div>
                        <div style={{ fontSize: "12px", color: "#475569", marginTop: "12px" }}>
                          {new Date(conv.updated_at).toLocaleDateString()} • {conv.message_count} messages
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Non-chat stub views ── */}
            {activeView !== "chat" && activeView !== "history" && activeView !== "debug" && !activeView.startsWith("conversation:") && (
              <StubView
                view={activeView}
                onBack={() => setActiveView("chat")}
              />
            )}

            {/* ── Conversation stub (past chats) ── */}
            {activeView.startsWith("conversation:") && (
              <ConversationStubView
                title={activeConversation ?? ""}
                onBack={() => { setActiveView("chat"); setActiveConversation(null); }}
              />
            )}

            {/* ── Debug Panel ── */}


            {/* ── Main Chat shell (default) ── */}
            {activeView === "chat" && (
              <section className="chatShell" aria-label="Chat interface">
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

                            {/* ── Plan Action Buttons (hidden after conversion) ── */}
                            {message.isPlan && !message.convertedToRoadmap && message.role === "assistant" && (
                              <div style={{
                                marginTop: "12px",
                                display: "flex",
                                gap: "8px",
                                flexWrap: "wrap",
                              }}>
                                <button
                                  type="button"
                                  disabled={isConvertingToRoadmap}
                                  onClick={() => handleConvertToRoadmap(message)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "10px 20px",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    color: "#fff",
                                    background: isConvertingToRoadmap ? "#94a3b8" : "#0ea5e9",
                                    border: "none",
                                    borderRadius: "8px",
                                    cursor: isConvertingToRoadmap ? "not-allowed" : "pointer",
                                    transition: "background 0.2s, box-shadow 0.2s",
                                    boxShadow: isConvertingToRoadmap ? "none" : "0 1px 3px rgba(14,165,233,0.3)",
                                  }}
                                  onMouseEnter={(e) => { if (!isConvertingToRoadmap) e.currentTarget.style.background = "#0284c7"; }}
                                  onMouseLeave={(e) => { if (!isConvertingToRoadmap) e.currentTarget.style.background = "#0ea5e9"; }}
                                >
                                  {isConvertingToRoadmap ? "Converting..." : "✅ Turn this into Visual Roadmap"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRefinePlan(message)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "10px 16px",
                                    fontSize: "13px",
                                    fontWeight: 500,
                                    color: "#64748b",
                                    background: "#f1f5f9",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    transition: "background 0.2s, border-color 0.2s",
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#e2e8f0"; e.currentTarget.style.borderColor = "#cbd5e1"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
                                >
                                  ✏️ Refine Plan
                                </button>
                              </div>
                            )}
                            {/* ── Converted badge (shown after conversion) ── */}
                            {message.isPlan && message.convertedToRoadmap && message.role === "assistant" && (
                              <div style={{
                                marginTop: "8px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                color: "#16a34a",
                                background: "#f0fdf4",
                                border: "1px solid #bbf7d0",
                                borderRadius: "6px",
                              }}>
                                ✅ Converted to Visual Roadmap
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                      {isChatLoading ? (
                        <article className="messageRow messageRowAssistant">
                          <div className="messageBubble messageBubbleAssistant">
                            <p>Thinking...</p>
                          </div>
                        </article>
                      ) : isPlanning ? (
                        <article className="messageRow messageRowAssistant">
                          <div className="messageBubble messageBubbleAssistant">
                            <p>Building your plan and opening the panel with today&apos;s next steps...</p>
                          </div>
                        </article>
                      ) : isAdjustingPlan ? (
                        <article className="messageRow messageRowAssistant">
                          <div className="messageBubble messageBubbleAssistant">
                            <p>Adapting your upcoming tasks based on your latest progress...</p>
                          </div>
                        </article>
                      ) : null}
                      <div ref={scrollAnchorRef} />
                    </div>
                  ) : (
                    <div className="emptyState">
                      <GuidedEntryPanel
                        activeTab={activeTab}
                        disabled={isChatLoading || isPlanning}
                        onQuestionSelect={handleGuidedQuestionSelect}
                        onTabChange={setActiveTab}
                      />
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className="composerWrap">
                  <form className="composerForm" onSubmit={handleSubmit}>
                    <label className="srOnly" htmlFor="chat-input">Message</label>
                    <div className="composerBox" style={{ position: "relative" }}>
                      <button
                        type="button"
                        ref={plusMenuBtnRef}
                        className="composerPlusBtn"
                        aria-label="Add attachment or switch modes"
                        title="Add options"
                        onClick={() => setPlusMenuOpen(!plusMenuOpen)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                      </button>

                      {plusMenuOpen && (
                        <div className="composerPlusMenu" ref={plusMenuRef}>
                          <button className="composerPlusMenuItem" type="button" onClick={() => { alert("Add files coming soon"); setPlusMenuOpen(false); }}>
                            <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 15h6" /><path d="M9 11h6" /></svg>
                            Add files
                          </button>
                          <div className="composerPlusMenuDivider" />
                          <div className="composerPlusMenuItem" style={{ cursor: "default" }}>
                            <div className="composerPlusToggleWrap">
                              <span>Chat Mode</span>
                              <button
                                type="button"
                                className="modeToggleBtn"
                                aria-checked={!planModeEnabled}
                                onClick={() => { setPlanModeEnabled(false); setPlusMenuOpen(false); }}
                              >
                                <span className="modeToggleThumb" />
                              </button>
                            </div>
                          </div>
                          <div className="composerPlusMenuItem" style={{ cursor: "default" }}>
                            <div className="composerPlusToggleWrap">
                              <span>Plan Mode</span>
                              <button
                                type="button"
                                className="modeToggleBtn"
                                aria-checked={planModeEnabled}
                                onClick={() => { setPlanModeEnabled(true); setPlusMenuOpen(false); }}
                              >
                                <span className="modeToggleThumb" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <textarea
                        ref={textareaRef}
                        id="chat-input"
                        className="composerTextarea"
                        style={{ paddingLeft: "48px" }}
                        rows={1}
                        value={draft}
                        onChange={handleDraftChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Message Life Agent…"
                        autoComplete="off"
                        disabled={isChatLoading || isPlanning}
                      />
                      <button
                        className="composerSend"
                        type="submit"
                        disabled={!draft.trim() || isChatLoading || isPlanning}
                        aria-label="Send message"
                      >
                        <IconSend />
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            )}

            {/* PLAN PANEL — rendered into layout-level root via portal */}
            <aside
              id="plan-panel"
              className={
                isPlanPanelOpen
                  ? isPlanPanelExpanded
                    ? "planPanel planPanelOpen planPanelExpanded"
                    : isPlanPanelResizing
                      ? "planPanel planPanelOpen planPanelResizing"
                      : "planPanel planPanelOpen"
                  : "planPanel"
              }
              style={{ width: `${activePlanPanelWidth}px` }}
              aria-label="Planning panel"
            >
              {/* Resize & Toggle handle — left border middle */}
              {isPlanPanelOpen && !isNarrow && (
                <div
                  className={
                    isPlanPanelResizing
                      ? "planResizeHandle planResizeHandleActive"
                      : isPlanPanelExpanded
                        ? "planResizeHandle planResizeHandleExpanded"
                        : "planResizeHandle"
                  }
                  onMouseDown={handleResizeMouseDown}
                  role="button"
                  aria-label={isPlanPanelExpanded ? "Collapse panel" : "Expand panel"}
                >
                  <div className="planHandleBar">
                    {isPlanPanelExpanded ? <IconChevronRight /> : <IconChevronLeft />}
                  </div>
                </div>
              )}
              {/* Positional Close Button — aligns with the floating toggle button, decoupled from header */}
              <button
                className="planPositionalToggle"
                type="button"
                onClick={() => setIsPlanPanelOpen(false)}
                aria-label="Close planning panel"
                title="Close planning panel"
              >
                <span className="floatingYourPlanBtnIcon">
                  <IconClose />
                </span>
                Your Plan
              </button>

              <div className="planHeader">
                <div className="planHeaderTop">
                  <h2 className="planHeading">{activeGoal?.title ?? "Active roadmap"}</h2>
                  <div className="planHeaderActions" />
                </div>
              </div>

              {!isPlanPanelExpanded ? (
                /* ── COMPACT MODE: Today's Summary ── */
                <div className="planCompactView">
                  <div className="planSection">
                    <div className="planLabel">Today's Focus</div>
                    {visibleTasks.length > 0 ? (
                      <div className="compactTasks">
                        {visibleTasks.slice(0, 2).map((task, idx) => (
                          <div key={task.id} className={idx === 0 ? "compactTaskMain" : "compactTaskNext"}>
                            <button
                              type="button"
                              className={task.status === "done" ? "taskCheckbox taskCheckboxDone" : "taskCheckbox"}
                              style={{ width: "18px", height: "18px", fontSize: "var(--text-xs)", margin: "2px 6px 0 0" }}
                              onClick={() => handleCompleteTask(task.id)}
                              disabled={task.status === "done" || pendingTaskIds.includes(task.id)}
                              aria-label={task.status === "done" ? "Task completed" : "Mark done"}
                            >
                              {task.status === "done" ? "✓" : pendingTaskIds.includes(task.id) ? "…" : ""}
                            </button>
                            <div className="compactTaskText" style={task.status === "done" ? { textDecoration: "line-through", color: "var(--text-tertiary)" } : {}}>
                              <strong>{idx === 0 ? "Main:" : "Next:"}</strong> {task.title}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="planCopy">No tasks scheduled for today.</p>
                    )}
                  </div>

                  <div className="planSection">
                    <div className="planLabel">Progress</div>
                    {activePlan ? (
                      <div className="compactProgressWrap">
                        <div className="compactProgressBar">
                          <div
                            className="compactProgressFill"
                            style={{ width: `${(activePlan.tasks.filter(t => t.status === "done").length / activePlan.tasks.length) * 100}%` }}
                          />
                        </div>
                        <span className="compactProgressLabel">
                          {activePlan.tasks.filter(t => t.status === "done").length} / {activePlan.tasks.length} tasks
                        </span>
                      </div>
                    ) : (
                      <p className="planCopy">Progress will appear once a plan starts.</p>
                    )}
                  </div>

                  <div className="planCompactMeta">
                    <p className="planCopy">Keep going! You're making great progress on your {activeGoal?.title ?? "goal"}.</p>
                  </div>
                </div>
              ) : (
                /* ── EXPANDED MODE: Full Planning System ── */
                <div className="planExpandedView">
                  <div className="planTabs" role="tablist" aria-label="System views">
                    <button
                      className={expandedPanelTab === "yourplan" ? "planTab planTabActive" : "planTab"}
                      type="button"
                      onClick={() => setExpandedPanelTab("yourplan")}
                    >Your Plan</button>
                    <button
                      className={expandedPanelTab === "roadmaps" ? "planTab planTabActive" : "planTab"}
                      type="button"
                      onClick={() => setExpandedPanelTab("roadmaps")}
                    >Roadmaps</button>
                    <button
                      className={expandedPanelTab === "progress" ? "planTab planTabActive" : "planTab"}
                      type="button"
                      onClick={() => setExpandedPanelTab("progress")}
                    >Progress</button>
                  </div>

                  {/* ── Your Plan tab: Hierarchical Month→Week→Day view ── */}
                  {expandedPanelTab === "yourplan" && (
                    <PlanRoadmapView
                      tasks={activePlan?.tasks ?? []}
                      onCompleteTask={handleCompleteTask}
                      pendingTaskIds={pendingTaskIds}
                      onAddTask={handleAddTask}
                    />
                  )}

                  {/* ── Roadmaps tab ── */}
                  {expandedPanelTab === "roadmaps" && (
                    <div className="planRoadmapsTab" style={{ display: 'flex', flexDirection: 'row', height: '100%', position: 'relative' }}>
                      
                      {/* Left Sidebar for Folders & Saved Roadmaps */}
                      <div className="roadmapSidebar" style={{ width: '220px', minWidth: '220px', borderRight: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
                         <div style={{ padding: '16px', fontWeight: '600', color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Your Library</div>
                         <div style={{ flexGrow: 1, overflowY: 'auto', padding: '12px' }}>
                           {isFetchingRoadmaps ? (
                             <p style={{ fontSize: '13px', color: '#94a3b8' }}>Loading...</p>
                           ) : savedRoadmaps.length === 0 ? (
                             <p style={{ fontSize: '13px', color: '#94a3b8' }}>No saved roadmaps yet.</p>
                           ) : (
                             <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                               {savedRoadmaps.map(rm => (
                                  <button 
                                    key={rm.id} 
                                    onClick={() => {
                                      setActivePlan({
                                        id: crypto.randomUUID(),
                                        goal_id: rm.id,
                                        tasks: [],
                                        created_at: new Date().toISOString(),
                                        textSummary: `Loaded roadmap: ${rm.title}`,
                                        roadmapData: rm.data
                                      });
                                      setShowGeneratorForm(false);
                                    }}
                                    style={{ 
                                      textAlign: 'left', padding: '8px', fontSize: '13px', 
                                      backgroundColor: activePlan?.goal_id === rm.id ? '#e0f2fe' : 'transparent', 
                                      color: activePlan?.goal_id === rm.id ? '#0284c7' : '#475569', 
                                      fontWeight: activePlan?.goal_id === rm.id ? '500' : 'normal',
                                      cursor: 'pointer', border: 'none', borderRadius: '4px', 
                                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                      transition: 'background 0.2s'
                                    }}
                                    title={rm.title}
                                    onMouseOver={(e) => { if(activePlan?.goal_id !== rm.id) e.currentTarget.style.backgroundColor = '#e2e8f0'; }}
                                    onMouseOut={(e) => { if(activePlan?.goal_id !== rm.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    📄 {rm.title.replace('Roadmap: ', '')}
                                  </button>
                               ))}
                             </div>
                           )}
                         </div>
                         
                         <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0' }}>
                           <button
                             type="button"
                             onClick={() => {
                               setShowGeneratorForm(true);
                               setActivePlan(null); // Clear viewing state
                             }}
                             style={{
                               width: '100%', padding: '8px', backgroundColor: '#0ea5e9', color: '#fff',
                               borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '500'
                             }}
                           >
                             + New Roadmap
                           </button>
                         </div>
                      </div>

                      {/* Main Viewer Area */}
                      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#ffffff' }}>

                        {/* Template Header Strip (Only show if no active roadmap and not generating) */}
                        {!activePlan?.roadmapData && !showGeneratorForm && (
                          <div style={{ display: 'flex', gap: '8px', padding: '12px 24px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', overflowX: 'auto' }}>
                            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500', alignSelf: 'center', marginRight: '8px' }}>Templates:</span>
                            {["BCS 1-Year", "BCS 6-Month", "Morning Routine"].map(key => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  setActivePlan({
                                    id: crypto.randomUUID(),
                                    goal_id: "roadmap-" + Date.now(),
                                    tasks: [],
                                    created_at: new Date().toISOString(),
                                    textSummary: `Loaded template: ${key}`,
                                    roadmapData: ROADMAP_TEMPLATES[key]
                                  });
                                }}
                                style={{
                                  whiteSpace: 'nowrap', padding: '6px 12px', backgroundColor: '#ffffff',
                                  color: '#475569', fontSize: '13px', fontWeight: '500', borderRadius: '6px',
                                  border: '1px solid #cbd5e1', cursor: 'pointer', transition: 'background 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ffffff'}
                              >
                                {key}
                              </button>
                            ))}
                          </div>
                        )}

                        {isChatLoading && planModeEnabled ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', flexGrow: 1 }}>
                            <div style={{ border: '3px solid #e2e8f0', borderTop: '3px solid #0ea5e9', borderRadius: '50%', width: '36px', height: '36px', animation: 'spin 1s linear infinite' }} />
                            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                            <p style={{ marginTop: '20px', color: '#64748b', fontWeight: '500', fontSize: 'var(--text-base)' }}>Analyzing your goals and weaving your roadmap...</p>
                          </div>
                        ) : activePlan?.roadmapData ? (
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flexGrow: 1 }}>
                            {/* Toolbar Top - Toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexShrink: 0 }}>
                               <div style={{ display: 'flex', backgroundColor: '#e2e8f0', padding: '4px', borderRadius: '8px' }}>
                                  <button onClick={() => setRoadmapViewMode("map")} style={{ padding: '6px 20px', fontSize: '13px', fontWeight: '500', borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: roadmapViewMode === 'map' ? '#fff' : 'transparent', color: roadmapViewMode === 'map' ? '#0f172a' : '#64748b', boxShadow: roadmapViewMode === 'map' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s' }}>View Map</button>
                                  <button onClick={() => setRoadmapViewMode("outline")} style={{ padding: '6px 20px', fontSize: '13px', fontWeight: '500', borderRadius: '6px', border: 'none', cursor: 'pointer', backgroundColor: roadmapViewMode === 'outline' ? '#fff' : 'transparent', color: roadmapViewMode === 'outline' ? '#0f172a' : '#64748b', boxShadow: roadmapViewMode === 'outline' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s' }}>Outline</button>
                               </div>
                            </div>

                            {/* Main Body */}
                            <div style={{ flexGrow: 1, overflowY: 'auto' }}>
                              {roadmapViewMode === 'map' ? (
                                <RoadmapViewer
                                  data={activePlan.roadmapData}
                                  onAddToPlan={() => setShowScheduleModal(true)}
                                  onRegenerate={() => {
                                    const action = draft.trim() ? draft : "Please refine or regenerate this roadmap.";
                                    setPlanModeEnabled(true);
                                    setDraft(action);
                                    textareaRef.current?.focus();
                                    window.requestAnimationFrame(() => {
                                      void submitChatMessage(action, "chat");
                                    });
                                  }}
                                />
                              ) : (
                                <OutlineViewer data={activePlan.roadmapData} />
                              )}
                            </div>
                          </div>
                        ) : showGeneratorForm ? (
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '32px', flexGrow: 1, maxWidth: '500px', margin: '0 auto', width: '100%', justifyContent: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: '600', color: '#334155' }}>Create New Roadmap</h3>
                            <button type="button" onClick={() => setShowGeneratorForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                              <IconClose />
                            </button>
                          </div>
                          <form onSubmit={handleGenerateRoadmap} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)', color: '#475569', fontWeight: '500' }}>Topic</label>
                              <input 
                                type="text" 
                                value={generatorTopic} 
                                onChange={e => setGeneratorTopic(e.target.value)}
                                placeholder="e.g. Learn React, Become Data Scientist"
                                required
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--text-sm)' }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)', color: '#475569', fontWeight: '500' }}>Difficulty</label>
                              <select 
                                value={generatorDifficulty} 
                                onChange={e => setGeneratorDifficulty(e.target.value)}
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--text-sm)', backgroundColor: '#fff' }}
                              >
                                <option value="beginner">Beginner</option>
                                <option value="intermediate">Intermediate</option>
                                <option value="advanced">Advanced</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontSize: 'var(--text-sm)', color: '#475569', fontWeight: '500' }}>AI Provider</label>
                              <select 
                                value={generatorProvider} 
                                onChange={e => setGeneratorProvider(e.target.value)}
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--text-sm)', backgroundColor: '#fff' }}
                              >
                                <option value="default">Default</option>
                                <option value="openai">OpenAI (GPT-4)</option>
                                <option value="gemini">Google Gemini</option>
                                <option value="mistral">Mistral</option>
                                <option value="groq">Groq</option>
                                <option value="ollama">Ollama (Local)</option>
                              </select>
                            </div>
                            <button
                              type="submit"
                              disabled={isGeneratingRoadmap || !generatorTopic.trim()}
                              style={{
                                marginTop: '12px',
                                padding: '12px',
                                backgroundColor: isGeneratingRoadmap || !generatorTopic.trim() ? '#94a3b8' : '#0ea5e9',
                                color: '#ffffff',
                                fontWeight: '500',
                                borderRadius: '8px',
                                border: 'none',
                                cursor: isGeneratingRoadmap || !generatorTopic.trim() ? 'not-allowed' : 'pointer',
                                transition: 'background 0.2s',
                              }}
                            >
                              {isGeneratingRoadmap ? "Generating..." : "Generate with AI ✨"}
                            </button>
                          </form>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '48px 32px', textAlign: 'center', flexGrow: 1 }}>
                          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
                          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>No Roadmap Yet</h3>
                          <p style={{ color: '#64748b', marginBottom: '24px', fontSize: 'var(--text-sm)', maxWidth: '280px', lineHeight: 1.5 }}>
                            Ready to map out your journey? Generate a highly visual and structured roadmap instantly.
                          </p>
                          <button
                            type="button"
                            onClick={() => setShowGeneratorForm(true)}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: '#0ea5e9',
                              color: '#ffffff',
                              fontWeight: '500',
                              borderRadius: '8px',
                              border: 'none',
                              cursor: 'pointer',
                              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                              transition: 'background 0.2s',
                            }}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
                          >
                            Generate with AI
                          </button>
                        </div>
                      )}
                      </div>
                    </div>
                  )}

                  {/* ── Progress tab ── */}
                  {expandedPanelTab === "progress" && (
                    <div className="planProgressTab">
                      <div className="planSection">
                        <div className="planLabel">Overall Progress</div>
                        {activePlan ? (
                          <>
                            <div className="compactProgressWrap" style={{ marginBottom: "16px" }}>
                              <div className="compactProgressBar">
                                <div
                                  className="compactProgressFill"
                                  style={{ width: `${(activePlan.tasks.filter(t => t.status === "done").length / activePlan.tasks.length) * 100}%` }}
                                />
                              </div>
                              <span className="compactProgressLabel">
                                {Math.round((activePlan.tasks.filter(t => t.status === "done").length / activePlan.tasks.length) * 100)}% Complete
                              </span>
                            </div>
                            <p className="planCopy">
                              Plan started on {formatCreatedAt(activePlan.created_at)}. Keep up the momentum!
                            </p>
                          </>
                        ) : (
                          <p className="planCopy">Progress will appear once a plan is active.</p>
                        )}
                      </div>
                      {activePlan && (
                        <div className="planSection" style={{ marginTop: "16px" }}>
                          <div className="planLabel">Status Overview</div>
                          <div className="progressStatsGrid">
                            <div className="progressStatCard progressStatDone">
                              <span className="progressStatValue">
                                {activePlan.tasks.filter(t => t.status === "done").length}
                              </span>
                              <span className="progressStatLabel">Done</span>
                            </div>
                            <div className="progressStatCard progressStatPending">
                              <span className="progressStatValue">
                                {activePlan.tasks.filter(t => t.status !== "done" && t.due_date >= new Date().toISOString().slice(0, 10)).length}
                              </span>
                              <span className="progressStatLabel">Pending</span>
                            </div>
                            <div className="progressStatCard progressStatDelayed">
                              <span className="progressStatValue">
                                {activePlan.tasks.filter(t => t.status !== "done" && t.due_date < new Date().toISOString().slice(0, 10)).length}
                              </span>
                              <span className="progressStatLabel">Delayed</span>
                            </div>
                            <div className="progressStatCard progressStatSkipped">
                              <span className="progressStatValue">0</span>
                              <span className="progressStatLabel">Skipped</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {activePlan && activeGoal && (
                        <div className="planSection" style={{ marginTop: "16px" }}>
                          <div className="planLabel">Roadmap: {activeGoal.title}</div>
                          <div className="compactProgressWrap" style={{ marginTop: "8px" }}>
                            <div className="compactProgressBar">
                              <div
                                className="compactProgressFill"
                                style={{ width: `${(activePlan.tasks.filter(t => t.status === "done").length / activePlan.tasks.length) * 100}%` }}
                              />
                            </div>
                            <span className="compactProgressLabel">
                              {activePlan.tasks.filter(t => t.status === "done").length} / {activePlan.tasks.length} tasks
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </section>
      </main>

      {/* ── SETTINGS MODAL (Global Overlay via Portal) ── */}
      {isSettingsModalOpen && typeof document !== "undefined" && createPortal(
        <div className="settingsBackdrop" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="settingsModal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="settingsModalHeader">
              <h2 className="settingsModalTitle">Settings</h2>
              <button className="settingsModalClose" onClick={() => setIsSettingsModalOpen(false)} aria-label="Close settings">
                <IconClose />
              </button>
            </div>

            <div className="settingsModalBody">
              <nav className="settingsModalSidebar">
                <button
                  className={activeSettingsTab === "preference" ? "settingsTab settingsTabActive" : "settingsTab"}
                  onClick={() => setActiveSettingsTab("preference")}
                >
                  <IconClockSmall /> Preference
                </button>
                <button
                  className={activeSettingsTab === "appearance" ? "settingsTab settingsTabActive" : "settingsTab"}
                  onClick={() => setActiveSettingsTab("appearance")}
                >
                  <IconLayoutGrid /> Appearance
                </button>
                <button
                  className={activeSettingsTab === "customize" ? "settingsTab settingsTabActive" : "settingsTab"}
                  onClick={() => setActiveSettingsTab("customize")}
                >
                  <IconPencilRuler /> Customize
                </button>
                <button
                  className={activeSettingsTab === "data" ? "settingsTab settingsTabActive" : "settingsTab"}
                  onClick={() => setActiveSettingsTab("data")}
                >
                  <IconBookmark /> Data Control
                </button>
              </nav>

              <main className="settingsModalContent">
                {activeSettingsTab === "preference" && (
                  <div className="settingsSection">
                    <h3 className="settingsSectionTitle">Preferences</h3>
                    <p className="settingsSectionDesc">Manage your personal app preferences and notifications.</p>
                    <div className="settingsPlaceholder">Preference options will appear here.</div>
                  </div>
                )}
                {activeSettingsTab === "appearance" && (
                  <div className="settingsSection">
                    <h3 className="settingsSectionTitle">Appearance</h3>
                    <p className="settingsSectionDesc">Customize how Life Agent looks on your device.</p>
                    <div className="settingsPlaceholder">Theme and layout controls will appear here.</div>
                  </div>
                )}
                {activeSettingsTab === "customize" && (
                  <div className="settingsSection">
                    <h3 className="settingsSectionTitle">Customize</h3>
                    <p className="settingsSectionDesc">Tailor the AI behavior and tool integrations to your needs.</p>
                    <div className="settingsPlaceholder">Customization tools will appear here.</div>
                  </div>
                )}
                {activeSettingsTab === "data" && (
                  <div className="settingsSection">
                    <h3 className="settingsSectionTitle">Data Control</h3>
                    <p className="settingsSectionDesc">Manage your data, privacy settings, and exports.</p>
                    <div className="settingsPlaceholder">Data management tools will appear here.</div>
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Schedule "Add to My Plan" Modal ─────────────────────── */}
      {showScheduleModal && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => !isScheduling && setShowScheduleModal(false)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(15,23,42,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999, backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#ffffff", borderRadius: "16px",
              padding: "32px", width: "480px", maxWidth: "calc(100vw - 32px)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
              display: "flex", flexDirection: "column", gap: "24px",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#0f172a" }}>
                  📅 Schedule Your Study Plan
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748b" }}>
                  {activePlan?.roadmapData?.title ? `Roadmap: ${activePlan.roadmapData.title}` : "Convert this roadmap into daily tasks"}
                </p>
              </div>
              <button
                onClick={() => setShowScheduleModal(false)}
                disabled={isScheduling}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "20px", lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Week selector */}
            <div>
              <label style={{ display: "block", marginBottom: "10px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                How many weeks to complete?
              </label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {[4, 6, 8, 12, 16, 24].map(w => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setScheduleWeeks(w)}
                    style={{
                      padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: "600",
                      border: scheduleWeeks === w ? "2px solid #0ea5e9" : "2px solid #e2e8f0",
                      backgroundColor: scheduleWeeks === w ? "#e0f2fe" : "#f8fafc",
                      color: scheduleWeeks === w ? "#0284c7" : "#64748b",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                  >{w}w</button>
                ))}
              </div>
            </div>

            {/* Day selector */}
            <div>
              <label style={{ display: "block", marginBottom: "10px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                Which days will you study?
              </label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const).map(day => {
                  const isActive = scheduleStudyDays.includes(day);
                  const label = day.charAt(0).toUpperCase() + day.slice(1, 3);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setScheduleStudyDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      )}
                      style={{
                        padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "600",
                        border: isActive ? "2px solid #0ea5e9" : "2px solid #e2e8f0",
                        backgroundColor: isActive ? "#e0f2fe" : "#f8fafc",
                        color: isActive ? "#0284c7" : "#94a3b8",
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                    >{label}</button>
                  );
                })}
              </div>
            </div>

            {/* Summary pill */}
            <div style={{
              backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: "10px", padding: "12px 16px",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <span style={{ fontSize: "20px" }}>📊</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#166534" }}>
                  {scheduleStudyDays.length > 0
                    ? `${scheduleWeeks * scheduleStudyDays.length} study sessions over ${scheduleWeeks} weeks`
                    : "Select at least one study day"}
                </div>
                <div style={{ fontSize: "12px", color: "#4ade80", marginTop: "2px" }}>
                  Starting {new Date().toLocaleDateString("default", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                disabled={isScheduling}
                style={{
                  padding: "10px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: "500",
                  border: "1px solid #e2e8f0", backgroundColor: "#f8fafc", color: "#64748b",
                  cursor: "pointer",
                }}
              >Cancel</button>
              <button
                type="button"
                onClick={handleScheduleSubmit}
                disabled={isScheduling || scheduleStudyDays.length === 0}
                style={{
                  padding: "10px 24px", borderRadius: "8px", fontSize: "14px", fontWeight: "600",
                  border: "none", backgroundColor: isScheduling || scheduleStudyDays.length === 0 ? "#94a3b8" : "#0ea5e9",
                  color: "#ffffff", cursor: isScheduling || scheduleStudyDays.length === 0 ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: "8px", transition: "background 0.2s",
                }}
                onMouseOver={(e) => { if (!isScheduling && scheduleStudyDays.length > 0) e.currentTarget.style.backgroundColor = "#0284c7"; }}
                onMouseOut={(e) => { if (!isScheduling && scheduleStudyDays.length > 0) e.currentTarget.style.backgroundColor = "#0ea5e9"; }}
              >
                {isScheduling ? (
                  <>
                    <span style={{ width: "14px", height: "14px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                    Scheduling…
                  </>
                ) : (
                  "🚀 Create My Study Plan"
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ── Stub views ─────────────────────────────────────────────── */
const STUB_META: Record<string, { title: string; emoji: string; description: string }> = {
  calendar: { title: "Calendar", emoji: "📅", description: "Your planner view is coming soon. You'll be able to see all your tasks and milestones in a calendar layout." },
  deepSearch: { title: "Deep Search", emoji: "🔍", description: "Deep Search lets you scan across all your conversations and plans. This feature is on its way." },
  todos: { title: "To-dos", emoji: "✅", description: "Your personal to-do list will live here. Track tasks independently from goal plans." },
  routine: { title: "Daily Routine", emoji: "⏰", description: "Build and track your ideal daily routine. Coming soon." },
  settings: { title: "Settings", emoji: "⚙️", description: "App preferences, account settings, and integrations will appear here." },
};

function StubView({ view, onBack }: { view: string; onBack: () => void }) {
  const isTemplate = view.startsWith("template:");
  const templateName = isTemplate ? view.replace("template:", "") : "";
  const meta = isTemplate ? null : STUB_META[view];

  return (
    <section className="chatShell stubViewShell" aria-label={isTemplate ? templateName : meta?.title}>
      <div className="stubViewContent">
        <div className="stubViewEmoji" aria-hidden="true">
          {isTemplate ? "📋" : meta?.emoji}
        </div>
        <h2 className="stubViewTitle">{isTemplate ? templateName : meta?.title}</h2>
        <p className="stubViewDesc">
          {isTemplate
            ? `The ${templateName} template page is coming soon. You'll be able to configure and launch this plan here.`
            : meta?.description}
        </p>
        <button className="stubViewBack" type="button" onClick={onBack}>
          ← Back to chat
        </button>
      </div>
    </section>
  );
}

function ConversationStubView({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <section className="chatShell stubViewShell" aria-label={title}>
      <div className="stubViewContent">
        <div className="stubViewEmoji" aria-hidden="true">💬</div>
        <h2 className="stubViewTitle">{title}</h2>
        <p className="stubViewDesc">
          This conversation will be fully loaded here. Conversation history persistence is coming soon.
        </p>
        <button className="stubViewBack" type="button" onClick={onBack}>
          ← New chat
        </button>
      </div>
    </section>
  );
}

function DebugView({ onBack, onLoadPlan }: { onBack: () => void; onLoadPlan: (goal: ParsedGoal, plan: Plan) => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [samplePlanId, setSamplePlanId] = useState<string | null>(null);

  const addLog = (msg: string) => setLogs(c => [...c, msg]);

  const handleTestSupabase = async () => {
    addLog("⏳ Testing Supabase...");
    try {
      const res = await requestJson<any>("/api/debug/test-db", "POST", {});
      if (res.success) {
        addLog(`✅ Supabase works! Test row created: ${JSON.stringify(res.data)}`);
      } else {
        addLog(`❌ Supabase test failed: ${res.error}`);
      }
    } catch (e: any) {
      addLog(`❌ Supabase request failed: ${e.message}`);
    }
  };

  const handleTestAI = async () => {
    addLog("⏳ Testing AI Provider...");
    try {
      const res = await requestJson<any>("/api/debug/test-llm", "POST", {});
      if (res.success) {
        addLog(`✅ AI responded: ${res.data.response}`);
      } else {
        addLog(`❌ AI test failed: ${res.error}`);
      }
    } catch (e: any) {
      addLog(`❌ AI request failed: ${e.message}`);
    }
  };

  const handleCreateSamplePlan = async () => {
    addLog("⏳ Creating Sample Plan in Supabase...");
    try {
      const res = await requestJson<any>("/api/debug/sample-plan", "POST", {});
      if (res.success) {
        setSamplePlanId(res.data.plan_id);
        addLog(`✅ Sample Plan created! Goal ID: ${res.data.goal_id}, Plan ID: ${res.data.plan_id}`);
      } else {
        addLog(`❌ Create Sample Plan failed: ${res.error}`);
      }
    } catch (e: any) {
      addLog(`❌ Create Sample request failed: ${e.message}`);
    }
  };

  const handleLoadSamplePlan = async () => {
    if (!samplePlanId) {
      addLog("⚠️ No Sample Plan ID available. Please create one first.");
      return;
    }

    addLog(`⏳ Loading Sample Plan ${samplePlanId}...`);
    try {
      const res = await requestJson<any>(`/api/debug/sample-plan/${samplePlanId}`, "GET", {});
      if (res.success) {
        addLog(`✅ Loaded Sample Plan! Sending to UI...`);
        onLoadPlan(res.data.goal, res.data.plan);
      } else {
        addLog(`❌ Load Sample Plan failed: ${res.error}`);
      }
    } catch (e: any) {
      addLog(`❌ Load Sample request failed: ${e.message}`);
    }
  };

  return (
    <section className="chatShell stubViewShell" aria-label="Debug Panel" style={{ alignItems: "stretch", padding: "24px 32px", overflowY: "auto" }}>
      <button className="stubViewBack" style={{ alignSelf: "flex-start", marginBottom: "24px" }} type="button" onClick={onBack}>
        ← Back to chat
      </button>
      <h2 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "16px" }}>Connectivity Test & Debug</h2>

      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
        <button onClick={handleTestSupabase} style={{ padding: "8px 16px", background: "var(--text-primary)", color: "white", borderRadius: "8px" }}>Test Supabase</button>
        <button onClick={handleTestAI} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", borderRadius: "8px" }}>Test AI</button>
        <button onClick={handleCreateSamplePlan} style={{ padding: "8px 16px", background: "var(--bg-sidebar-active)", color: "var(--text-primary)", borderRadius: "8px" }}>Create Sample Plan</button>
        <button onClick={handleLoadSamplePlan} disabled={!samplePlanId} style={{ padding: "8px 16px", background: "var(--text-secondary)", color: "white", borderRadius: "8px", opacity: !samplePlanId ? 0.5 : 1 }}>Load Sample Plan</button>
      </div>

      <div style={{ background: "var(--bg-page)", borderRadius: "8px", padding: "16px", minHeight: "360px", fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", overflowY: "auto" }}>
        {logs.length === 0 ? <span style={{ color: "var(--text-tertiary)" }}>Awaiting test results...</span> : null}
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: "6px", color: "var(--text-primary)" }}>{log}</div>
        ))}
      </div>
    </section>
  );
}

/* ── HTTP helpers ────────────────────────────────────────────── */
import { supabase } from "../lib/supabase";

async function requestJson<TResponse>(path: string, method: "POST" | "PUT" | "GET" | "PATCH" | "DELETE", body?: object): Promise<TResponse> {
  const options: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (method !== "GET" && method !== "DELETE" && body) {
    options.body = JSON.stringify(body);
  }

  // Attach auth token if available
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    (options.headers as any)["Authorization"] = `Bearer ${token}`;
  }

  const fullUrl = `${apiBaseUrl}${path}`;
  console.log(`[requestJson] Fetching: ${fullUrl}`);

  let response: Response;
  try {
    response = await fetch(fullUrl, options);
  } catch (networkError: any) {
    console.log(`[requestJson] Network failure:`, networkError);
    throw new Error(`Network failure: Could not reach backend server at ${apiBaseUrl}`);
  }

  console.log(`[requestJson] HTTP Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Backend route not found (404) at ${path}`);
    }

    // Attempt to extract detail string, fallback to raw text
    const text = await response.text().catch(() => "");

    if (response.status >= 500) {
      console.log(`[requestJson] Server crashed (500). Raw response:`, text);
      throw new Error(`Backend crashed (500). Server said: ${text ? text.slice(0, 100) + "..." : "No output."}`);
    }

    try {
      const payload = JSON.parse(text);
      throw new Error(payload?.detail ?? `HTTP Error ${response.status}: ${text.slice(0, 50)}`);
    } catch {
      console.log(`[requestJson] Non-JSON error response from server:`, text);
      throw new Error(`HTTP Error ${response.status} with non-JSON response: ${text.slice(0, 100)}...`);
    }
  }

  const responseText = await response.text();
  try {
    return JSON.parse(responseText) as TResponse;
  } catch (parseError: any) {
    console.log(`[requestJson] Invalid JSON from server. Raw text:`, responseText);
    throw new Error(`Invalid JSON response from server. Check console for raw text.`);
  }
}

async function postJson<TResponse>(path: string, body: object): Promise<TResponse> {
  return requestJson<TResponse>(path, "POST", body);
}

async function putJson<TResponse>(path: string, body: object): Promise<TResponse> {
  return requestJson<TResponse>(path, "PUT", body);
}

/* ── Business logic helpers ────────────────────────────────── */
function buildPlanSummary(goal: ParsedGoal, plan: Plan): string {
  const nextTask = getEarliestTodoTask(plan.tasks);
  const nextStep = nextTask ? ` Start with "${nextTask.title}" by ${formatDueDate(nextTask.due_date)}.` : "";
  return `Here is your plan for "${goal.title}". I created ${plan.tasks.length} steps from near-term actions to longer-term milestones.${nextStep}`;
}

function buildAdjustmentSummary(plan: Plan): string {
  const nextTodo = plan.tasks.find((task) => task.status === "todo");
  const catchUpTask = plan.tasks.find((task) => task.title.toLowerCase().includes("catch-up"));

  if (catchUpTask) {
    return `I adjusted your plan and added a catch-up step: "${catchUpTask.title}" due ${formatDueDate(catchUpTask.due_date)}.`;
  }
  if (nextTodo) {
    return `I adjusted your plan. Your next focus is "${nextTodo.title}" due ${formatDueDate(nextTodo.due_date)}.`;
  }
  return "I adjusted your plan based on your recent progress.";
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function getVisibleTasks(tasks: PlanTask[], planView: PlanView): PlanTask[] {
  const startOfToday = getStartOfToday();
  const endOfToday = addDays(startOfToday, 1);
  const weekBoundary = addDays(startOfToday, 8);
  const monthBoundary = addDays(startOfToday, 31);

  return [...tasks]
    .filter((task) => {
      const taskDate = getStartOfDate(task.due_date);
      if (planView === "today") return taskDate >= startOfToday && taskDate < endOfToday;
      if (planView === "week") return taskDate >= startOfToday && taskDate < weekBoundary;
      return taskDate >= startOfToday && taskDate < monthBoundary;
    })
    .sort((left, right) => left.due_date.localeCompare(right.due_date));
}

function getPlanViewLabel(planView: PlanView): string {
  if (planView === "today") return "Today";
  if (planView === "week") return "This week";
  return "This month";
}

function getEmptyStateCopy(planView: PlanView): string {
  if (planView === "today") return "Nothing is due today yet. Switch to Week or Month to see the upcoming tasks.";
  if (planView === "week") return "No tasks are due in the next 7 days.";
  return "No tasks are due in the next 30 days.";
}

function isDueToday(value: string): boolean {
  return getStartOfDate(value).getTime() === getStartOfToday().getTime();
}

function isOverdue(value: string): boolean {
  return getStartOfDate(value) < getStartOfToday();
}

function getDueDateClassName(value: string): string {
  if (isOverdue(value)) return "planTaskDue planTaskDueOverdue";
  if (isDueToday(value)) return "planTaskDue planTaskDueToday";
  return "planTaskDue";
}

function formatStatus(value: PlanTask["status"]): string {
  return value === "done" ? "Done" : "To do";
}

function getTaskCardClassName(task: PlanTask): string {
  if (task.status === "done") return "planTaskItem planTaskItemDone";
  if (isOverdue(task.due_date)) return "planTaskItem planTaskItemOverdue";
  return "planTaskItem";
}

function getStartOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getStartOfDate(value: string): Date {
  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function getEarliestTodoTask(tasks: PlanTask[]): PlanTask | undefined {
  return [...tasks]
    .filter((task) => task.status === "todo")
    .sort((left, right) => left.due_date.localeCompare(right.due_date))[0];
}

function clonePlan(plan: Plan): Plan {
  return { ...plan, tasks: plan.tasks.map((task) => ({ ...task })) };
}

function reorderTasks(tasks: PlanTask[], sourceTaskId: string, targetTaskId: string): PlanTask[] {
  const sourceIndex = tasks.findIndex((task) => task.id === sourceTaskId);
  const targetIndex = tasks.findIndex((task) => task.id === targetTaskId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return tasks;

  const reordered = [...tasks];
  const [movedTask] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, movedTask);
  return reordered;
}
