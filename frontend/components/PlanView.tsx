"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  listActivePlans,
  listAllPlans,
  pausePlan,
  resumePlan,
  generatePlan,
  type PlanResponse,
  type PlanStatus,
} from "../lib/adaptive";

const STATUS_BADGE: Record<PlanStatus, string> = {
  setup: "Setup",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

export function PlanView() {
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [memoryId, setMemoryId] = useState("");

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = showAll ? await listAllPlans() : await listActivePlans();
      setPlans(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handlePause = async (planId: string) => {
    setActing(planId);
    try {
      await pausePlan({ plan_id: planId });
      await fetchPlans();
    } catch (err) {
      console.error("Failed to pause plan:", err);
    } finally {
      setActing(null);
    }
  };

  const handleResume = async (planId: string) => {
    setActing(planId);
    try {
      await resumePlan({ plan_id: planId });
      await fetchPlans();
    } catch (err) {
      console.error("Failed to resume plan:", err);
    } finally {
      setActing(null);
    }
  };

  const handleGenerate = async () => {
    if (!memoryId.trim()) return;
    setActing("generate");
    try {
      await generatePlan({ memory_id: memoryId.trim() });
      setMemoryId("");
      await fetchPlans();
    } catch (err) {
      console.error("Failed to generate plan:", err);
    } finally {
      setActing(null);
    }
  };

  return (
    <section className="viewContainer" aria-label="Plan details">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 className="viewTitle">Plans</h2>
        <button
          className="viewActionBtn"
          onClick={() => setShowAll((v) => !v)}
          disabled={loading}
        >
          {showAll ? "Active Only" : "Show All"}
        </button>
      </div>

      {/* Generate plan from memory */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          type="text"
          placeholder="Memory ID to generate plan from"
          value={memoryId}
          onChange={(e) => setMemoryId(e.target.value)}
          style={{
            flex: 1,
            padding: "6px 10px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        />
        <button
          className="viewActionBtn"
          onClick={handleGenerate}
          disabled={acting === "generate" || !memoryId.trim()}
        >
          Generate
        </button>
      </div>

      {loading && <p className="viewEmpty">Loading plans…</p>}
      {error && <p className="viewEmpty" style={{ color: "var(--color-danger)" }}>{error}</p>}

      {!loading && !error && plans.length === 0 && (
        <p className="viewEmpty">No plans yet. Generate one from a memory entry above.</p>
      )}

      {!loading && !error && plans.length > 0 && (
        <div className="viewList">
          {plans.map((plan) => (
            <div key={plan.id} className="viewListItem">
              <div className="viewListItemTitle">{plan.title ?? "Untitled Plan"}</div>
              <div className="viewListItemMeta">
                Priority: {plan.priority} • Intensity: {plan.intensity} •{" "}
                <span style={{ fontWeight: 600 }}>{STATUS_BADGE[plan.status]}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {plan.status === "active" && (
                  <button
                    className="viewActionBtn"
                    onClick={() => handlePause(plan.id)}
                    disabled={acting === plan.id}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                  >
                    Pause
                  </button>
                )}
                {plan.status === "paused" && (
                  <button
                    className="viewActionBtn"
                    onClick={() => handleResume(plan.id)}
                    disabled={acting === plan.id}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
