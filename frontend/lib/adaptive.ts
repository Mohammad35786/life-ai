/**
 * adaptive.ts — Types and API service for the adaptive planning backend.
 *
 * Endpoints covered:
 *   GET  /api/adaptive/tasks/today
 *   POST /api/adaptive/tasks/update
 *   POST /api/adaptive/plan/pause
 *   POST /api/adaptive/plan/resume
 *   POST /api/adaptive/tasks/busy
 *   POST /api/adaptive/extract-memory
 *   POST /api/adaptive/create-plan
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./api";

// ── Enum types (mirrors backend/adaptive/models.py) ──────────────────────────

export type PlanStatus = "setup" | "active" | "paused" | "completed";
export type PlanPriority = "high" | "medium" | "low";
export type PlanIntensity = "light" | "moderate" | "intense";
export type TaskStatus = "pending" | "done" | "skipped" | "partial";
export type TaskDifficulty = "easy" | "intermediate" | "hard";
export type MemoryKey = "goal" | "constraint" | "preference" | "context" | "milestone";

// ── Response types (mirrors backend/adaptive/schemas.py) ─────────────────────

export type PlanResponse = {
  id: string;
  goal_id: string | null;
  user_id: string | null;
  title: string | null;
  status: PlanStatus;
  priority: PlanPriority;
  intensity: PlanIntensity;
  created_at: string;
  updated_at: string;
};

export type MilestoneInsightResponse = {
  milestone_id: string;
  insight: Record<string, any>;
  raw: string | null;
  generated: boolean;
};

export type MilestoneStatus = "locked" | "active" | "completed";

export type TaskResponse = {
  id: string;
  plan_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: TaskStatus;
  priority: string;
  difficulty: TaskDifficulty;
  parent_id: string | null;
  carry_over_count: number;
  milestone_id: string | null;
  order_index: number;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
};

export type MilestoneResponse = {
  id: string;
  plan_id: string;
  user_id: string;
  title: string;
  description: string | null;
  order_index: number;
  status: MilestoneStatus;
  suggested_days: number | null;
  outcome: string | null;
  tasks: TaskResponse[];
  created_at: string;
  updated_at: string;
};

export type MemoryResponse = {
  id: string;
  user_id: string;
  key: MemoryKey;
  value: string;
  source: string;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ExtractedField = {
  key: string;
  value: string;
  id: string | null;
};

export type TaskDetailResource = {
  type: "video" | "article" | "app" | "book";
  title: string;
  description: string;
};

export type TaskDetailHowToStep = {
  step: number;
  instruction: string;
};

export type TaskDetailData = {
  what_is_this: string;
  why_it_matters: string;
  how_to_do_it: TaskDetailHowToStep[];
  resources: TaskDetailResource[];
  todays_example: string;
  expert_tip: string;
  estimated_difficulty: "easy" | "medium" | "hard";
};

export type TaskDetailResponse = {
  task_id: string;
  detail: TaskDetailData;
  generated: boolean;
};

export type CreatePlanResponse = {
  plan: PlanResponse;
  tasks: TaskResponse[];
  task_count: number;
};

// ── Request types ─────────────────────────────────────────────────────────────

export type TaskUpdatePayload = {
  task_id: string;
  status: TaskStatus;
  feedback_text?: string;
};

export type PlanControlPayload = {
  plan_id: string;
};

export type ExtractMemoryPayload = {
  conversation: string;
};

export type GeneratePlanPayload = {
  memory_id: string;
};

// ── API functions ─────────────────────────────────────────────────────────────

/** GET /api/adaptive/tasks/today */
export function getTodayTasks(): Promise<TaskResponse[]> {
  return apiGet<TaskResponse[]>("/api/adaptive/tasks/today");
}

/** POST /api/adaptive/tasks/update */
export function updateTask(payload: TaskUpdatePayload): Promise<TaskResponse> {
  return apiPost<TaskResponse>("/api/adaptive/tasks/update", payload);
}

/** POST /api/adaptive/plan/pause */
export function pausePlan(payload: PlanControlPayload): Promise<PlanResponse> {
  return apiPost<PlanResponse>("/api/adaptive/plan/pause", payload);
}

/** POST /api/adaptive/plan/resume */
export function resumePlan(payload: PlanControlPayload): Promise<PlanResponse> {
  return apiPost<PlanResponse>("/api/adaptive/plan/resume", payload);
}

/** POST /api/adaptive/tasks/busy */
export function markDayBusy(): Promise<TaskResponse[]> {
  return apiPost<TaskResponse[]>("/api/adaptive/tasks/busy", {});
}

/** POST /api/adaptive/extract-memory */
export function extractMemory(payload: ExtractMemoryPayload): Promise<{ extracted: ExtractedField[]; count: number }> {
  return apiPost<{ extracted: ExtractedField[]; count: number }>('/api/adaptive/extract-memory', payload);
}

/** POST /api/adaptive/create-plan */
export function generatePlan(payload: GeneratePlanPayload): Promise<CreatePlanResponse> {
  return apiPost<CreatePlanResponse>("/api/adaptive/create-plan", payload);
}

/** GET /api/adaptive/plans — list active plans */
export function listActivePlans(): Promise<PlanResponse[]> {
  return apiGet<PlanResponse[]>("/api/adaptive/plans");
}

/** GET /api/adaptive/plans/all — list all plans including paused/completed */
export function listAllPlans(): Promise<PlanResponse[]> {
  return apiGet<PlanResponse[]>('/api/adaptive/plans/all');
}

/** GET /api/adaptive/plans/{planId}/milestones — milestones with nested tasks */
export function getPlanMilestones(planId: string): Promise<MilestoneResponse[]> {
  return apiGet<MilestoneResponse[]>(`/api/adaptive/plans/${planId}/milestones`);
}

/** GET /api/adaptive/milestones/{milestoneId}/insight — structured LLM insight */
export function getMilestoneInsight(milestoneId: string): Promise<MilestoneInsightResponse> {
  return apiGet<MilestoneInsightResponse>(`/api/adaptive/milestones/${milestoneId}/insight`);
}

export type CheckMilestoneCompletionResponse = {
  completed: boolean;
  milestone: MilestoneResponse | null;
  next_milestone: MilestoneResponse | null;
};

/** GET /api/adaptive/milestones/{milestoneId}/check-completion */
export function checkMilestoneCompletion(milestoneId: string): Promise<CheckMilestoneCompletionResponse> {
  return apiGet<CheckMilestoneCompletionResponse>(`/api/adaptive/milestones/${milestoneId}/check-completion`);
}

/** GET /api/adaptive/tasks/{taskId}/detail — lazy-generated task detail */
export function getTaskDetail(taskId: string): Promise<TaskDetailResponse> {
  return apiGet<TaskDetailResponse>(`/api/adaptive/tasks/${taskId}/detail`);
}

/** GET /api/adaptive/memory — list memory items for user */
export function listMemory(): Promise<MemoryResponse[]> {
  return apiGet<MemoryResponse[]>("/api/adaptive/memory");
}

/** DELETE /api/adaptive/memory/{id} — delete a memory item */
export function deleteMemory(memoryId: string): Promise<void> {
  return apiDelete(`/api/adaptive/memory/${memoryId}`);
}

/** PATCH /api/adaptive/plans/{id} — update plan status/priority/etc */
export function patchPlan(planId: string, payload: Partial<Pick<PlanUpdatePayload, "status" | "priority" | "title" | "intensity">>): Promise<PlanResponse> {
  return apiPatch<PlanResponse>(`/api/adaptive/plans/${planId}`, payload);
}

/** DELETE /api/adaptive/plans/{id} — delete a plan */
export function deletePlan(planId: string): Promise<{ deleted: boolean }> {
  return apiDelete(`/api/adaptive/plans/${planId}`);
}

/** POST /api/adaptive/memory/extract — extract memory from conversation */
export function extractMemoryFromChat(payload: { conversation: string }): Promise<{ extracted: ExtractedField[]; count: number }> {
  return apiPost<{ extracted: ExtractedField[]; count: number }>("/api/adaptive/memory/extract", payload);
}

/** POST /api/adaptive/plans/generate — generate plan from memory_id */
export function generatePlanFromMemory(payload: { memory_id: string }): Promise<CreatePlanResponse> {
  return apiPost<CreatePlanResponse>("/api/adaptive/plans/generate", payload);
}

/** Plan update payload type for patch */
export type PlanUpdatePayload = {
  status: PlanStatus;
  priority: PlanPriority;
  title: string;
  intensity: PlanIntensity;
};

// ── Plan Setup types ──────────────────────────────────────────────────────────

export type QuickOption = {
  label: string;
  value: number | string;
};

export type PlanSetupStartPayload = {
  memory_id?: string;
  conversation: { role: "user" | "assistant"; content: string }[];
};

export type PlanSetupStartResponse = {
  plan_id: string;
  setup_step: string;
  message: string;
  quick_options: QuickOption[];
  memory_summary: string | null;
};

export type PlanSetupDurationPayload = {
  duration_days: number;
};

export type PlanSetupDurationResponse = {
  setup_step: string;
  message: string;
  quick_options: QuickOption[];
};

export type PlanSetupSchedulePayload = {
  type: string;
  days?: number[] | null;
};

export type PlanSetupScheduleResponse = {
  setup_step: string;
  plan_id: string;
  milestone_count?: number;
  first_milestone?: string;
  tasks_today?: number;
  message?: string;
};

// ── Plan Setup API functions ──────────────────────────────────────────────────

/** POST /api/adaptive/plans/setup/start — extract memory & start setup dialogue */
export function startPlanSetup(payload: PlanSetupStartPayload): Promise<PlanSetupStartResponse> {
  return apiPost<PlanSetupStartResponse>("/api/adaptive/plans/setup/start", payload);
}

/** POST /api/adaptive/plans/{planId}/setup/duration — save duration choice */
export function savePlanDuration(planId: string, payload: PlanSetupDurationPayload): Promise<PlanSetupDurationResponse> {
  return apiPost<PlanSetupDurationResponse>(`/api/adaptive/plans/${planId}/setup/duration`, payload);
}

/** POST /api/adaptive/plans/{planId}/setup/schedule — save schedule choice */
export function savePlanSchedule(planId: string, payload: PlanSetupSchedulePayload): Promise<PlanSetupScheduleResponse> {
  return apiPost<PlanSetupScheduleResponse>(`/api/adaptive/plans/${planId}/setup/schedule`, payload);
}

// ── Session Context ──────────────────────────────────────────────────────────

export type SessionContext = {
  active_tab: "today" | "chat";
  open_plan_id: string | null;
  open_milestone_id: string | null;
  open_task_id: string | null;
};

/** POST /api/chat — send a chat message with session context */
export function sendMessage(content: string, sessionContext: SessionContext): Promise<{ reply: string }> {
  return apiPost<{ reply: string }>("/api/chat", {
    message: content,
    session_context: sessionContext,
  });
}

// ── Plan Detail ──────────────────────────────────────────────────────────────

export type PlanDetailStats = {
  total_tasks: number;
  completed_tasks: number;
  remaining_tasks: number;
  total_milestones: number;
  completed_milestones: number;
  progress_pct: number;
  current_milestone: { id: string; title: string; order_index: number } | null;
  next_milestone: { id: string; title: string; order_index: number } | null;
  next_task: { id: string; title: string; milestone_id: string | null } | null;
};

export type PlanDetailResponse = {
  plan: PlanResponse;
  stats: PlanDetailStats;
  milestones: MilestoneResponse[];
};

/** GET /api/adaptive/plans/{planId}/detail — full plan detail with stats */
export function getPlanDetail(planId: string): Promise<PlanDetailResponse> {
  return apiGet<PlanDetailResponse>(`/api/adaptive/plans/${planId}/detail`);
}

// ── Plan Chat ────────────────────────────────────────────────────────────────

export type PlanChatAction = {
  action: string;
  target_id: string | null;
  params: Record<string, any>;
};

export type PlanChatResponse = {
  reply: string;
  actions: PlanChatAction[];
};

/** POST /api/adaptive/plans/{planId}/chat — AI chat about a plan */
export function sendPlanChat(planId: string, message: string): Promise<PlanChatResponse> {
  return apiPost<PlanChatResponse>(`/api/adaptive/plans/${planId}/chat`, { message });
}
