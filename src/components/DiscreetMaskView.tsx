import React, { useState, useEffect } from 'react';
import { Terminal, Shield, Eye, Lock, ArrowLeft } from 'lucide-react';

interface DiscreetMaskViewProps {
  onExitMask: () => void;
}

export const DiscreetMaskView: React.FC<DiscreetMaskViewProps> = ({ onExitMask }) => {
  const [editorText, setEditorText] = useState(
`// src/engine/distributed_consensus.ts
import { EventEmitter } from 'events';

export interface PeerNodeConfig {
  nodeId: string;
  heartbeatIntervalMs: number;
  maxRetries: number;
  replicationFactor: number;
}

export class DistributedStreamEngine extends EventEmitter {
  private activeStreams: Map<string, ArrayBuffer> = new Map();
  private stateMachineVersion: number = 2.4;

  constructor(private readonly config: PeerNodeConfig) {
    super();
    this.initializeClusterTopology();
  }

  private async initializeClusterTopology(): Promise<void> {
    // Synchronizing zero-copy memory buffers
    console.log('[cluster] Synchronizing local shard tables...');
  }
}`
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExitMask();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExitMask]);

  return (
    <div className="fixed inset-0 z-50 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs flex flex-col select-none">
      {/* Fake VS Code / Editor Top Bar */}
      <div className="h-9 bg-[#323233] border-b border-[#252526] px-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* macOS window dots */}
          <div className="flex items-center gap-1.5 mr-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          <span className="text-zinc-400 text-[11px]">distributed_consensus.ts — Workspace — VS Code</span>
        </div>

        {/* Discreet Restore Trigger disguised as tiny build status */}
        <button
          onClick={onExitMask}
          title="Exit Discreet Mask (or press Escape)"
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white px-2 py-0.5 rounded hover:bg-[#3c3c3d] text-[11px] transition-colors cursor-pointer"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span>TSC 5.4 Passing · Exit Mask (Esc)</span>
        </button>
      </div>

      {/* Editor Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fake Mini Explorer Sidebar */}
        <div className="w-48 bg-[#252526] border-r border-[#1e1e1e] p-2 hidden sm:block">
          <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-2 font-bold">Explorer</div>
          <div className="space-y-1 text-[11px] text-zinc-400">
            <div className="text-white bg-[#37373d] px-1.5 py-0.5 rounded">distributed_consensus.ts</div>
            <div className="px-1.5 py-0.5 hover:text-white">package.json</div>
            <div className="px-1.5 py-0.5 hover:text-white">tsconfig.json</div>
            <div className="px-1.5 py-0.5 hover:text-white">README.md</div>
          </div>
        </div>

        {/* Code Canvas */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e]">
          <div className="flex-1 p-4 overflow-y-auto">
            <textarea
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              className="w-full h-full bg-transparent text-[#9cdcfe] font-mono text-xs sm:text-sm resize-none focus:outline-none leading-relaxed"
              spellCheck={false}
            />
          </div>

          {/* Fake Integrated Terminal */}
          <div className="h-28 bg-[#181818] border-t border-[#2d2d2d] p-3 text-[11px] text-zinc-400 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="text-zinc-500 font-bold uppercase text-[9px]">Terminal — zsh (pid 4108)</div>
              <div className="text-emerald-400">➜ cluster-core git:(main) bun run build</div>
              <div className="text-zinc-300">[10:41:02] Transpiled 48 modules in 14ms. Ready on localhost:4000.</div>
            </div>
            <div className="text-zinc-600 text-[10px] flex items-center justify-between">
              <span>UTF-8 · TypeScript · LF</span>
              <button onClick={onExitMask} className="hover:text-zinc-300 underline">
                Restore gayze
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
