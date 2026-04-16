from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from backend.models import Goal, Plan, Task, TaskCreate, TaskStatus
from backend.lib.llm import chatResponse


class PlanningEngineError(RuntimeError):
    """Raised when the planning engine cannot produce a valid plan."""


@dataclass
class PlanningEngineService:
    def generate_tasks(self, goal: Goal) -> list[TaskCreate]:
        prompt = (
            "You are a planning engine for long-term goals. "
            "Think through yearly phases, monthly milestones, and weekly tasks, "
            "but only return structured JSON. "
            "Create 6 to 8 tasks in increasing complexity, with concise titles that "
            "make the hierarchy visible using prefixes like 'Week 1 task:', 'Month 1 goal:', or 'Year 1 phase:'.\n\n"
            "Return EXACTLY a JSON dictionary with a 'tasks' key mapping to a list of tasks. "
            "Each task must have 'title' (string), 'due_in_days' (integer, 1 to 1460), and 'priority' ('high', 'medium', 'low').\n"
            "Do not include any raw markdown blocks, only the JSON object.\n\n"
            f"Goal title: {goal.title}\n"
            f"Goal description: {goal.description}\n"
            f"Today's date: {date.today().isoformat()}"
        )
        
        try:
            content = chatResponse(prompt)
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            parsed = json.loads(content)
            tasks = []
            for item in parsed.get("tasks", []):
                tasks.append(
                    TaskCreate(
                        title=item["title"],
                        due_date=date.today() + timedelta(days=int(item["due_in_days"])),
                        status=TaskStatus.todo,
                        priority=item.get("priority", "medium"),
                    )
                )
            if len(tasks) < 3:
                raise ValueError("Not enough tasks")
            return tasks
        except Exception as exc:
            print(f"Planner LLM failed: {exc}")
            return self._fallback_plan(goal)

    def adjust_tasks(self, goal: Goal, plan: Plan) -> list[TaskCreate]:
        completed_tasks = [task for task in plan.tasks if task.status == TaskStatus.done]
        pending_tasks = [task for task in plan.tasks if task.status == TaskStatus.todo]

        prompt = (
            "You are an adaptive planning engine. "
            "Given a goal and current task progress, rewrite only the upcoming todo tasks. "
            "Preserve momentum after completions and create catch-up tasks if overdue items exist. "
            "Return 4 to 8 upcoming tasks with realistic sequencing and due offsets.\n\n"
            "Return EXACTLY a JSON dictionary with a 'tasks' key mapping to a list of tasks. "
            "Each task must have 'title' (string), 'due_in_days' (integer, 1 to 1460), and 'priority' ('high', 'medium', 'low').\n"
            "Do not include any raw markdown blocks, only the JSON object.\n\n"
            f"Goal title: {goal.title}\n"
            f"Goal description: {goal.description}\n"
            f"Today's date: {date.today().isoformat()}\n"
            f"Completed tasks: {json.dumps([self._task_snapshot(task) for task in completed_tasks])}\n"
            f"Pending tasks: {json.dumps([self._task_snapshot(task) for task in pending_tasks])}"
        )
        
        try:
            content = chatResponse(prompt)
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            parsed = json.loads(content)
            adjusted_tasks = [
                TaskCreate(
                    title=item["title"],
                    due_date=date.today() + timedelta(days=int(item["due_in_days"])),
                    status=TaskStatus.todo,
                    priority=item.get("priority", "medium"),
                )
                for item in parsed.get("tasks", [])
            ]
            if len(adjusted_tasks) < 3:
                raise ValueError("Not enough tasks")
            return adjusted_tasks
        except Exception as exc:
            print(f"Planner Adjust LLM failed: {exc}")
            return self._fallback_adjusted_plan(goal, plan)

    def _fallback_plan(self, goal: Goal) -> list[TaskCreate]:
        goal_text = f"{goal.title} {goal.description}".lower()
        years = self._extract_years(goal_text)
        due_offsets = self._build_due_offsets(years)
        blueprints = self._build_task_blueprints(goal, years)

        tasks = [
            TaskCreate(
                title=title,
                due_date=date.today() + timedelta(days=due_in_days),
                status=TaskStatus.todo,
                priority=priority,
            )
            for (title, priority), due_in_days in zip(blueprints, due_offsets, strict=True)
        ]
        return tasks

    def _fallback_adjusted_plan(self, goal: Goal, plan: Plan) -> list[TaskCreate]:
        today = date.today()
        completed_tasks = [task for task in plan.tasks if task.status == TaskStatus.done]
        pending_tasks = [task for task in plan.tasks if task.status == TaskStatus.todo]
        overdue_tasks = [task for task in pending_tasks if task.due_date < today]
        upcoming_tasks = sorted(
            [task for task in pending_tasks if task.due_date >= today],
            key=lambda task: task.due_date,
        )

        adjusted_tasks: list[TaskCreate] = []
        due_cursor = 1

        if overdue_tasks:
            adjusted_tasks.append(
                TaskCreate(
                    title="Catch-up task: Recover missed work and reset this week's priorities",
                    due_date=today + timedelta(days=1),
                    status=TaskStatus.todo,
                    priority="high",
                )
            )
            due_cursor += 2

        if completed_tasks:
            last_completed = sorted(completed_tasks, key=lambda task: task.due_date)[-1]
            adjusted_tasks.append(
                TaskCreate(
                    title=f"Momentum task: Build on '{last_completed.title}' with the next focused session",
                    due_date=today + timedelta(days=due_cursor),
                    status=TaskStatus.todo,
                    priority="high",
                )
            )
            due_cursor += 2

        for task in upcoming_tasks[:4]:
            adjusted_tasks.append(
                TaskCreate(
                    title=task.title,
                    due_date=today + timedelta(days=due_cursor),
                    status=TaskStatus.todo,
                    priority="high" if task.priority == "high" else "medium",
                )
            )
            due_cursor += 6

        existing_titles = {task.title for task in adjusted_tasks}
        completed_titles = {task.title for task in completed_tasks}
        base_candidates = self._fallback_plan(goal)
        for candidate in base_candidates:
            if candidate.title in existing_titles or candidate.title in completed_titles:
                continue
            adjusted_tasks.append(
                TaskCreate(
                    title=candidate.title,
                    due_date=today + timedelta(days=due_cursor),
                    status=TaskStatus.todo,
                    priority=candidate.priority,
                )
            )
            due_cursor += 10
            if len(adjusted_tasks) >= 6:
                break

        if len(adjusted_tasks) < 4:
            adjusted_tasks.extend(
                [
                    TaskCreate(
                        title="Week reset task: Review what is blocked and simplify the next few steps",
                        due_date=today + timedelta(days=1),
                        status=TaskStatus.todo,
                        priority="high",
                    ),
                    TaskCreate(
                        title="Month focus goal: Recommit to one realistic milestone with a lighter schedule",
                        due_date=today + timedelta(days=14),
                        status=TaskStatus.todo,
                        priority="medium",
                    ),
                ]
            )

        return adjusted_tasks[:8]

    def _extract_years(self, text: str) -> int:
        match = re.search(r"(\d+)\s+years?", text)
        if not match:
            return 3
        years = int(match.group(1))
        return min(max(years, 1), 5)

    def _build_due_offsets(self, years: int) -> list[int]:
        yearly_offsets = [365 * index for index in range(1, years + 1)]
        return [7, 14, 30, 60, 120, *yearly_offsets][: max(6, len(yearly_offsets) + 5)]

    def _build_task_blueprints(self, goal: Goal, years: int) -> list[tuple[str, str]]:
        goal_text = f"{goal.title} {goal.description}".lower()

        if any(keyword in goal_text for keyword in ("data scientist", "data science", "machine learning")):
            yearly_phase_titles = [
                "Year 1 phase: Build foundations in Python, statistics, and data analysis",
                "Year 2 phase: Complete portfolio projects with real datasets and basic models",
                "Year 3 phase: Specialize, network, and prepare for job-ready interviews",
                "Year 4 phase: Deepen specialization through advanced modeling and domain work",
                "Year 5 phase: Lead ambitious projects and refine a strong professional niche",
            ]
            return [
                ("Week 1 task: Set a study routine and begin Python fundamentals", "high"),
                ("Week 2 task: Practice notebooks, data structures, and small coding exercises", "high"),
                ("Month 1 goal: Finish an introductory statistics course with summary notes", "high"),
                ("Month 2 goal: Complete SQL, data cleaning, and exploratory analysis practice", "medium"),
                ("Month 4 goal: Build a small end-to-end analysis project from a public dataset", "medium"),
                *[(title, "medium") for title in yearly_phase_titles[:years]],
            ]

        generic_yearly_titles = [
            f"Year 1 phase: Build the core knowledge and habits needed for {goal.title.lower()}",
            f"Year 2 phase: Apply your skills through projects and measurable practice for {goal.title.lower()}",
            f"Year 3 phase: Turn progress into visible results and external feedback for {goal.title.lower()}",
            f"Year 4 phase: Raise the difficulty and pursue advanced opportunities tied to {goal.title.lower()}",
            f"Year 5 phase: Consolidate expertise and sustain long-term momentum toward {goal.title.lower()}",
        ]
        return [
            ("Week 1 task: Clarify success criteria and block focused time on your calendar", "high"),
            ("Week 2 task: Gather the best beginner resources and complete the first practice session", "high"),
            ("Month 1 goal: Finish one foundational learning module and capture key takeaways", "high"),
            ("Month 2 goal: Create a repeatable practice routine and track progress weekly", "medium"),
            ("Month 4 goal: Complete a small project that demonstrates early competence", "medium"),
            *[(title, "medium") for title in generic_yearly_titles[:years]],
        ]

    def _task_snapshot(self, task: Task) -> dict[str, str]:
        return {
            "title": task.title,
            "due_date": task.due_date.isoformat(),
            "status": task.status.value,
            "priority": task.priority,
        }


planning_engine_service = PlanningEngineService()
