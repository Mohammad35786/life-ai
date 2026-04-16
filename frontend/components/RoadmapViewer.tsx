import React, { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RoadmapData } from './chat-window';

// Custom Node for "main" type - large, main trajectory
const MainNode = ({ data, selected }: any) => {
  return (
    <div style={{
      backgroundColor: selected ? '#eff6ff' : '#ffffff',
      border: `2px solid ${selected ? '#0ea5e9' : '#38bdf8'}`,
      borderRadius: '12px',
      padding: '24px 28px',
      minWidth: '260px',
      boxShadow: selected 
        ? '0 0 0 4px rgba(14, 165, 233, 0.15)' 
        : '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
      textAlign: 'center',
      transition: 'all 0.2s',
      cursor: 'pointer'
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#0284c7', width: 12, height: 12, top: -6 }} />
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: '700', color: '#0f172a', marginBottom: data.description ? '8px' : '0' }}>
        {data.label}
      </div>
      {data.description && (
        <div style={{ fontSize: 'var(--text-sm)', color: '#475569', lineHeight: 1.5 }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#0284c7', width: 12, height: 12, bottom: -6 }} />
      
      {/* Handlers for side branches */}
      <Handle type="source" position={Position.Right} id="right" style={{ background: '#0284c7', width: 10, height: 10, right: -5 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ background: '#0284c7', width: 10, height: 10, left: -5 }} />
    </div>
  );
};

// Custom Node for "module" or "side" type - medium, yellow, softer design
const SideNode = ({ data, selected }: any) => {
  return (
    <div style={{
      backgroundColor: selected ? '#fefce8' : '#ffffff',
      border: `2px solid ${selected ? '#eab308' : '#fde047'}`,
      borderRadius: '12px',
      padding: '16px',
      maxWidth: '220px',
      boxShadow: selected 
        ? '0 0 0 4px rgba(234, 179, 8, 0.15)' 
        : '0 1px 3px rgba(0, 0, 0, 0.05)',
      textAlign: 'left',
      transition: 'all 0.2s',
      cursor: 'pointer'
    }}>
      <Handle type="target" position={Position.Left} id="left-target" style={{ background: '#ca8a04', width: 8, height: 8, left: -4 }} />
      <Handle type="target" position={Position.Right} id="right-target" style={{ background: '#ca8a04', width: 8, height: 8, right: -4 }} />
      <Handle type="target" position={Position.Top} id="top-target" style={{ background: '#ca8a04', width: 8, height: 8, top: -4 }} />
      
      <div style={{ fontSize: 'var(--text-base)', fontWeight: '600', color: '#451a03', marginBottom: data.description ? '6px' : '0' }}>
        {data.label}
      </div>
      {data.description && (
        <div style={{ fontSize: 'var(--text-sm)', color: '#78350f', lineHeight: 1.5 }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: '#ca8a04', width: 8, height: 8, bottom: -4 }} />
    </div>
  );
};

const nodeTypes = {
  main: MainNode,
  module: SideNode,
  side: SideNode,
};

type RoadmapViewerProps = {
  data: RoadmapData;
  onRegenerate?: () => void;
  onAddToPlan?: () => void;
};

export function RoadmapViewer({ data, onRegenerate, onAddToPlan }: RoadmapViewerProps) {
  // Translate our custom data format to React Flow format
  const initialNodes = useMemo(() => {
    return data.nodes.map((node) => ({
      id: node.id,
      type: node.type, // Maps to 'main', 'module', or 'side' custom nodes via nodeTypes
      position: node.position,
      data: { label: node.data.label, description: node.data.description },
    }));
  }, [data.nodes]);

  const initialEdges = useMemo(() => {
    return data.edges.map((edge) => {
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: edge.animated,
        // Make edges softer but bolder to look intentional
        style: { stroke: '#cbd5e1', strokeWidth: 3 },
      }
    });
  }, [data.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = React.useState<any>(null);

  // Update flow when upstream data changes (e.g. user toggles between active plans)
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNode(null);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header Area */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid #e2e8f0',
        background: '#ffffff',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: '600', color: '#334155', flexGrow: 1 }}>Your Roadmap</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onAddToPlan && (
            <button
              onClick={onAddToPlan}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0ea5e9',
                border: 'none',
                borderRadius: '6px',
                fontSize: 'var(--text-sm)',
                fontWeight: '600',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
            >
              📅 Add to My Plan
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: 'var(--text-sm)',
                fontWeight: '500',
                color: '#475569',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            >
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* React Flow Canvas */}
      <div style={{ flexGrow: 1, minHeight: '500px', backgroundColor: '#f8fafc', position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedNode(node)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.5 }}
          minZoom={0.2}
          maxZoom={2}
          attributionPosition="bottom-right"
        >
          <Background color="#cbd5e1" variant={BackgroundVariant.Dots} gap={24} size={2} />
          <Controls showInteractive={false} style={{ boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
        </ReactFlow>

        {/* Selected Node Panel Overlay */}
        {selectedNode && (
          <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: '320px',
            backgroundColor: '#ffffff',
            borderLeft: '1px solid #e2e8f0',
            boxShadow: '-4px 0 15px rgba(0,0,0,0.05)',
            padding: '24px',
            zIndex: 10,
            overflowY: 'auto',
            animation: 'slideIn 0.3s ease-out forwards',
          }}>
            <style>{`
              @keyframes slideIn {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
              }
            `}</style>
            <button 
              onClick={() => setSelectedNode(null)}
              style={{ float: 'right', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94a3b8' }}
              aria-label="Close panel"
            >✕</button>
            
            <h3 style={{ marginTop: 0, color: '#0f172a', fontSize: 'var(--text-xl)', fontWeight: '600' }}>
              {selectedNode.data.label}
            </h3>
            
            <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
              <p style={{ color: '#475569', fontSize: 'var(--text-sm)', lineHeight: 1.5, margin: 0 }}>
                {selectedNode.data.description || "No specific details provided for this node."}
              </p>
            </div>
            
            <h4 style={{ color: '#334155', fontSize: 'var(--text-base)', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#0ea5e9' }}>📋</span> Sample Task List
            </h4>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {["Review primary concepts", "Complete associated practice items", "Summarize learnings for review"].map((task, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <input type="checkbox" style={{ marginTop: '3px', cursor: 'pointer' }} />
                  <span style={{ fontSize: 'var(--text-sm)', color: '#475569', lineHeight: 1.4 }}>{task}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
