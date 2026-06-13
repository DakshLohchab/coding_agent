import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, Spacer } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import { container } from '../di/container.js';
import { ConfigService } from '../services/config.js';

const COMMANDS = [
  { name: '/help', desc: 'Show commands' },
  { name: '/model', desc: 'Switch LLM' },
  { name: '/skills', desc: 'Load MCP tools' },
  { name: '/clear', desc: 'Clear history' },
  { name: '/compact', desc: 'Compact context' },
  { name: '/sessions', desc: 'List sessions' },
  { name: '/exit', desc: 'Exit app' }
];

const MODELS = ['Gemini API', 'Anthropic Claude', 'OpenAI', 'OpenRouter', 'Fireworks'];

const STATE_META: Record<string, { label: string; color: string; icon: string }> = {
  idle:         { label: 'IDLE',       color: 'gray',    icon: '○' },
  architecting: { label: 'ARCH',       color: 'blue',    icon: '⚙' },
  executing:    { label: 'EXEC',       color: 'cyan',    icon: '▶' },
  verifying:    { label: 'VERIFY',     color: 'yellow',  icon: '◈' },
  debating:     { label: 'DEBATE',     color: 'magenta', icon: '◉' },
  done:         { label: 'DONE',       color: 'green',   icon: '✓' },
  failed:       { label: 'FAIL',       color: 'red',     icon: '✖' },
};

const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
};

// Helper to render a simple progress bar for token usage
const ProgressBar = ({ percent }: { percent: number }) => {
  const width = 15;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return <Text color="magenta">{'█'.repeat(filled)}{'░'.repeat(empty)}</Text>;
};

export const OrchestratorUI = ({ ioLayer, collisionDetector, eventBroker, actor }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [chatLog, setChatLog] = useState<{ role: string; text: string; summary?: any; timestamp?: Date }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentThought, setCurrentThought] = useState('');
  const [currentModel, setCurrentModel] = useState('Claude');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modelMenu, setModelMenu] = useState(false);
  const [modelSelectedIndex, setModelSelectedIndex] = useState(0);
  const [askingApiKeyFor, setAskingApiKeyFor] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  
  const MAX_TOKENS = 200000; // Example max context

  const filteredCommands = COMMANDS.filter(c => c.name.startsWith(chatInput.toLowerCase()));
  const showAutocomplete = chatInput.startsWith('/') && !modelMenu && !askingApiKeyFor;

  useEffect(() => {
    if (actor && typeof actor.subscribe === 'function') {
      const sub = actor.subscribe((state: any) => {
        setStateValue(state.value);
        if (state.value === 'done' || state.value === 'failed') {
          setIsSubmitting(false);
          setCurrentThought('');
        }
      });
      return () => { if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe(); };
    }
  }, [actor]);

  useEffect(() => {
    if (!eventBroker) return;
    const handleStateChange = (state: string) => setStateValue(state);
    const handleAgentMessage = (msg: string) => setChatLog(prev => [...prev, { role: 'agent', text: msg, timestamp: new Date() }]);
    const handleThought = (thought: string) => setCurrentThought(thought);

    eventBroker.on('agent.state_change', handleStateChange);
    eventBroker.on('agent.message', handleAgentMessage);
    eventBroker.on('agent.thought', handleThought);

    return () => {
      eventBroker.off('agent.state_change', handleStateChange);
      eventBroker.off('agent.message', handleAgentMessage);
      eventBroker.off('agent.thought', handleThought);
    };
  }, [eventBroker]);

  const handleSubmit = (query: string) => {
    if (!query.trim()) return;
    setChatLog(prev => [...prev, { role: 'user', text: query, timestamp: new Date() }]);
    setChatInput('');
    setIsSubmitting(true);
    if (actor) {
      actor.send({ type: 'START', prompt: query });
    }
  };

  const meta = STATE_META[stateValue] || STATE_META.idle;
  const isActive = stateValue !== 'idle' && stateValue !== 'done' && stateValue !== 'failed';
  const filesCount = chatLog.filter(m => m.role === 'agent').length * 3;
  const tokensCount = chatLog.length * 1240;
  const tokenPercent = Math.min(100, (tokensCount / MAX_TOKENS) * 100);

  return (
    <Box flexDirection="column" height="100%" width="100%">
      
      {/* ══ HEADER ═══ */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Gradient name="pastel">
            <Text bold>OpenClaw</Text>
          </Gradient>
          <Text color="gray" dimColor>AGENT ORCHESTRATOR</Text>
          <Text color="gray" dimColor>v2.0.0</Text>
        </Box>
        
        <Box flexDirection="row" alignItems="center" gap={3}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color="green">●</Text>
            <Text color="gray" dimColor>VOICE I/O: READY</Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color="magenta">🧠</Text>
            <Text color="white" bold>{currentModel}</Text>
          </Box>
          <Box paddingX={1} borderStyle="single" borderColor={meta.color}>
            <Text color={meta.color} bold>{meta.icon} {meta.label}</Text>
          </Box>
        </Box>
      </Box>

      {/* ══ MAIN CONTENT ═══ */}
      <Box flexDirection="row" flexGrow={1} overflow="hidden" marginTop={0} gap={1}>
        
        {/* ─── CHAT & EXECUTION AREA ─── */}
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="blue" padding={1}>
          
          <Box flexDirection="column" flexGrow={1} overflowY="hidden" marginBottom={1}>
            {chatLog.length === 0 && (
              <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
                <Text color="gray" dimColor>⚡ LOCAL AGENT READY</Text>
                <Text color="gray" dimColor>Type /help to view commands, or initiate a local OS task...</Text>
              </Box>
            )}

            {/* Message Rendering... (Keep existing map logic, but use softer colors) */}
          </Box>

          {/* Active Thought Stream */}
          {isActive && (
            <Box borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="row" alignItems="center" gap={2} marginBottom={1}>
              <Spinner type="dots" />
              <Text color="yellow" bold>AGENT THINKING:</Text>
              <Text color="white">{currentThought}</Text>
            </Box>
          )}

          {/* Fixed Input Area */}
          <Box flexDirection="column" borderStyle="single" borderColor={showAutocomplete ? "yellow" : "gray"} paddingX={1}>
            {showAutocomplete && (
              <Box flexDirection="column" marginBottom={1} borderBottom={true} borderStyle="single" borderColor="gray">
                {/* Autocomplete Menu Logic */}
              </Box>
            )}
            
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text bold color="cyanBright">❯</Text>
              <TextInput
                value={chatInput}
                onChange={setChatInput}
                onSubmit={handleSubmit}
                placeholder="Awaiting command..."
              />
            </Box>
          </Box>
        </Box>

        {/* ─── RIGHT TELEMETRY PANEL ─── */}
        <Box width={30} flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
          <Text bold color="white">TELEMETRY</Text>
          <Spacer />
          
          <Box flexDirection="column" gap={0} marginBottom={2}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color="gray">Context Load</Text>
              <Text color="cyan">{tokenPercent.toFixed(0)}%</Text>
            </Box>
            <ProgressBar percent={tokenPercent} />
            <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
              <Text color="gray" dimColor>Tokens</Text>
              <Text color="white">{formatTokens(tokensCount)} / 200K</Text>
            </Box>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color="gray" dimColor>Modified Files</Text>
              <Text color="white">{filesCount}</Text>
            </Box>
          </Box>

          <Text bold color="green">INTEGRATIONS</Text>
          <Spacer />
          <Box flexDirection="column" gap={0} marginBottom={2}>
            <Text color="green">● PowerShell Bridge</Text>
            <Text color="green">● Semantic A11y Tree</Text>
            <Text color="yellow">◐ Browser Automation</Text>
            <Text color="gray">○ Claude Code Protocol</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};