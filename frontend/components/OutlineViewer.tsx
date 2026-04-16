import React from "react";
import { RoadmapData, RoadmapOutline } from "./chat-window";

type OutlineViewerProps = {
  data: RoadmapData;
};

export function OutlineViewer({ data }: OutlineViewerProps) {
  const { nodes, edges, outlines, title } = data;

  // We group tasks into their corresponding main modules
  // A 'main' node is a module.
  const modules = nodes
    .filter((n) => n.type === "main")
    .sort((a, b) => a.position.y - b.position.y); // sort physically down the spine

  return (
    <div style={{ padding: "32px", maxWidth: "800px", margin: "0 auto", color: "#334155" }}>
      <h2 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "32px", color: "#0f172a" }}>
        {title || "Roadmap Outline"}
      </h2>
      
      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {modules.map((mod, index) => {
          // Find the rich outline data built by the AI
          const outlineData: RoadmapOutline | undefined = outlines?.[mod.id];
          
          // Find actual ReactFlow child nodes hooked to this main module using edges
          const childEdges = edges.filter(e => e.source === mod.id);
          const rawTasks = childEdges.map(e => nodes.find(n => n.id === e.target)).filter(Boolean);

          return (
            <div 
              key={mod.id} 
              style={{ padding: "24px", backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
            >
              <div style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "16px", marginBottom: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#0ea5e9", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Module {index + 1}
                </div>
                <h3 style={{ fontSize: "20px", fontWeight: "700", color: "#1e293b", margin: "0 0 8px 0" }}>
                  {outlineData?.title || mod.data.label}
                </h3>
                
                {(outlineData?.description || mod.data.description) && (
                  <p style={{ fontSize: "15px", color: "#475569", lineHeight: "1.6", margin: 0 }}>
                    {outlineData?.description || mod.data.description}
                  </p>
                )}
                
                {outlineData?.estimatedTime && (
                  <div style={{ marginTop: "12px", display: "inline-block", backgroundColor: "#f0fdf4", color: "#166534", padding: "4px 10px", borderRadius: "16px", fontSize: "13px", fontWeight: "500" }}>
                    ⏱ {outlineData.estimatedTime}
                  </div>
                )}
              </div>

              {/* Tasks / Subtopics */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h4 style={{ fontSize: "16px", fontWeight: "600", color: "#334155", margin: "0 0 4px 0" }}>Topics to Cover</h4>
                
                {/* Always prefer rich AI subtopics if they exist */}
                {outlineData?.subtopics && outlineData.subtopics.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: "24px", color: "#475569", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {outlineData.subtopics.map((topic, i) => (
                      <li key={i} style={{ fontSize: "15px", lineHeight: "1.5" }}>{topic}</li>
                    ))}
                  </ul>
                ) : rawTasks.length > 0 ? (
                  /* Fallback to simple nodes */
                  <ul style={{ margin: 0, paddingLeft: "24px", color: "#475569", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {rawTasks.map((t, i) => (
                      <li key={i} style={{ fontSize: "15px", lineHeight: "1.5" }}>
                        <strong>{t?.data.label}</strong> {t?.data.description && `- ${t.data.description}`}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: "14px", color: "#94a3b8", fontStyle: "italic", margin: 0 }}>No explicit sub-topics mapped.</p>
                )}
              </div>

              {/* Resources */}
              {outlineData?.resources && outlineData.resources.length > 0 && (
                <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <h4 style={{ fontSize: "15px", fontWeight: "600", color: "#334155", margin: 0 }}>Recommended Resources</h4>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {outlineData.resources.map((res, i) => (
                      <span key={i} style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "4px 12px", borderRadius: "16px", fontSize: "13px" }}>
                        {res}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
