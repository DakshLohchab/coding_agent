import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import { container } from '../di/container.js';
import { ConfigService } from '../services/config.js';

const COMMANDS = [
  { name: '/model', desc: 'Switch LLM provider' },
  { name: '/skills', desc: 'Load a new MCP tool or custom system instruction' },
  { name: '/clear', desc: 'Clear the terminal history' },
  { name: '/exit', desc: 'Graceful shutdown' }
];

const MODELS = ['Gemini API', 'Anthropic Claude', 'OpenAI', 'OpenRouter', 'Fireworks'];

export const OrchestratorUI = ({ eventBroker, actor }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [chatLog, setChatLog] = useState<{ role: string, text: string, summary?: any }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentThought, setCurrentThought] = useState('');

  // Autocomplete and Sub-menu States
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modelMenu, setModelMenu] = useState(false);
  const [modelSelectedIndex, setModelSelectedIndex] = useState(0);
  const [askingApiKeyFor, setAskingApiKeyFor] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const filteredCommands = COMMANDS.filter(c => c.name.startsWith(chatInput.toLowerCase()));
  const showAutocomplete = chatInput.startsWith('/') && !modelMenu && !askingApiKeyFor;

  useEffect(() => {
    setSelectedIndex(0);
  }, [chatInput]);

  useInput((input, key) => {
    if (modelMenu) {
      if (key.upArrow) {
        setModelSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setModelSelectedIndex(prev => Math.min(MODELS.length - 1, prev + 1));
      } else if (key.return) {
        setAskingApiKeyFor(MODELS[modelSelectedIndex]);
        setModelMenu(false);
      } else if (key.escape) {
        setModelMenu(false);
        setChatInput('');
      }
    } else if (askingApiKeyFor) {
      if (key.escape) {
        setAskingApiKeyFor('');
        setApiKeyInput('');
        setChatInput('');
      }
    } else if (showAutocomplete) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(filteredCommands.length - 1, prev + 1));
      }
    }
  }, { isActive: showAutocomplete || modelMenu || !!askingApiKeyFor });

  useEffect(() => {
    const handleStateChange = (state: string) => {
      setStateValue(state);
      if (state === 'idle' || state === 'done' || state === 'failed') {
        setIsSubmitting(false);
        setCurrentThought('');
      }
    };
    eventBroker.on('agent.state_change', handleStateChange);

    const handleReply = (message: string) => {
      setChatLog((log) => [...log, { role: 'agent', text: message }]);
    };
    eventBroker.on('agent.reply', handleReply);

    const handleThought = (thought: string) => {
      setCurrentThought(thought);
    };
    eventBroker.on('agent.thought', handleThought);

    const handleSummary = (summaryData: any) => {
      setChatLog((log) => [...log, { role: 'system', text: 'Summary Report Generated', summary: summaryData }]);
    };
    eventBroker.on('agent.summary', handleSummary);

    return () => {
      eventBroker.off('agent.state_change', handleStateChange);
      eventBroker.off('agent.reply', handleReply);
      eventBroker.off('agent.thought', handleThought);
      eventBroker.off('agent.summary', handleSummary);
    };
  }, [eventBroker]);

  const executeCommand = (cmd: string) => {
    if (cmd === '/clear') {
      setChatLog([]);
      setChatInput('');
    } else if (cmd === '/exit') {
      process.exit(0);
    } else if (cmd === '/model') {
      setModelMenu(true);
    } else if (cmd === '/skills') {
      setChatLog(log => [...log, { role: 'system', text: 'Skills sub-system not yet implemented.' }]);
      setChatInput('');
    }
  };

  const handleSubmit = (query: string) => {
    if (showAutocomplete && filteredCommands.length > 0) {
      const selected = filteredCommands[selectedIndex];
      executeCommand(selected.name);
      return;
    }
    if (query.trim().length > 0 && !isSubmitting) {
      setChatLog((log) => [...log, { role: 'user', text: query.trim() }]);
      setIsSubmitting(true);
      setChatInput('');
      actor.send({ type: 'START', prompt: query.trim() });
    }
  };

  const getStatusText = () => {
    switch (stateValue) {
      case 'idle': return <Text color="gray">Idle</Text>;
      case 'architecting': return <Text color="blue">⚙️ Architecting Plan...</Text>;
      case 'executing': return <Text color="cyan">💻 Executing Code Diffs...</Text>;
      case 'verifying': return <Text color="yellow">🔬 Verifying Syntax & Logic...</Text>;
      case 'debating': return <Text color="magenta">🗣️ Debating Alternative Strategies...</Text>;
      case 'done': return <Text color="green">✅ Success</Text>;
      case 'failed': return <Text color="red">❌ Failed</Text>;
      default: return <Text color="white">{stateValue}</Text>;
    }
  };

  return (
    <Box flexDirection="column" minHeight={24} width="100%">
      {/* 1. Header Panel */}
      <Box borderStyle="single" borderColor="magenta" paddingX={2} paddingY={0} justifyContent="center">
        <Gradient name="pastel">
          <Text bold>⚡ CA-2026 ORCHESTRATOR</Text>
        </Gradient>
      </Box>

      {/* 2. History Panel */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1} marginTop={1}>
        {chatLog.slice(-10).map((msg, index) => {
          if (msg.role === 'system' && msg.summary) {
            return (
              <Box key={index} borderStyle="round" borderColor="green" padding={1} flexDirection="column" marginTop={1} marginBottom={1}>
                <Text bold color="green">📊 Execution Summary</Text>
                <Text>Files Modified: {msg.summary.filesModified}</Text>
                <Text>Commands Executed: {msg.summary.commandsExecuted}</Text>
                <Text>Retries/Failures Resolved: {msg.summary.retriesResolved}</Text>
              </Box>
            );
          }
          if (msg.role === 'system') {
            return (
              <Box key={index} marginTop={1} marginBottom={1}>
                <Text bold color="yellow">System: </Text>
                <Text color="yellow">{msg.text}</Text>
              </Box>
            );
          }
          if (msg.role === 'agent') {
            return (
              <Box key={index} borderStyle="round" borderColor="green" padding={1} flexDirection="column" marginTop={1} marginBottom={1}>
                <Text bold color="green">Agent:</Text>
                <Text>{msg.text}</Text>
              </Box>
            );
          }
          return (
            <Box key={index} marginTop={1} marginBottom={1}>
              <Text bold color="cyan">You: </Text>
              <Text color="cyan">{msg.text}</Text>
            </Box>
          );
        })}
        {chatLog.length === 0 && <Text dimColor color="gray">Awaiting your commands...</Text>}
      </Box>

      {/* 3. Live Status Panel (only when active) */}
      {stateValue !== 'idle' && stateValue !== 'done' && stateValue !== 'failed' && (
        <Box borderStyle="round" borderColor="yellow" padding={1} flexDirection="column" marginBottom={1} width="100%">
          <Box flexDirection="row">
            {isSubmitting && (
              <Box marginRight={1}>
                <Text color="green"><Spinner type="dots" /></Text>
              </Box>
            )}
            {getStatusText()}
          </Box>
          {currentThought && (
            <Box marginTop={1}>
              <Text dimColor italic color="gray">💭 {currentThought}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* 4. Input Panel with Autocomplete */}
      <Box borderStyle="bold" borderColor="blue" paddingX={1} paddingY={0} flexDirection="column" width="100%">
        {showAutocomplete && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="yellow">Available Commands:</Text>
            {filteredCommands.length > 0 ? filteredCommands.map((cmd, index) => (
              <Text key={cmd.name} color={index === selectedIndex ? 'cyanBright' : 'white'} bold={index === selectedIndex}>
                {index === selectedIndex ? '▶ ' : '  '}{cmd.name} - <Text dimColor>{cmd.desc}</Text>
              </Text>
            )) : <Text color="gray">  No commands found.</Text>}
          </Box>
        )}

        {askingApiKeyFor ? (
          <Box flexDirection="row">
            <Box marginRight={1}>
              <Text bold color="yellow">Enter API Key for {askingApiKeyFor} (Esc to cancel):</Text>
            </Box>
            <TextInput
              value={apiKeyInput}
              onChange={setApiKeyInput}
              onSubmit={(keyInput) => {
                if (keyInput.trim().length > 0) {
                  const configService = container.resolve(ConfigService);
                  configService.saveConfig({ provider: askingApiKeyFor, apiKey: keyInput.trim() });
                  setChatLog(log => [...log, { role: 'system', text: `LLM Provider switched to: ${askingApiKeyFor}` }]);
                  setAskingApiKeyFor('');
                  setApiKeyInput('');
                  setChatInput('');
                }
              }}
            />
          </Box>
        ) : modelMenu ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="yellow">Select LLM Provider (Up/Down to navigate, Enter to select, Esc to cancel):</Text>
            {MODELS.map((m, index) => (
              <Text key={m} color={index === modelSelectedIndex ? 'cyanBright' : 'white'} bold={index === modelSelectedIndex}>
                {index === modelSelectedIndex ? '▶ ' : '  '}{m}
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="row">
            <Box marginRight={1}>
              <Text bold color="cyanBright">🚀 {'>'}</Text>
            </Box>
            <TextInput
              value={chatInput}
              onChange={setChatInput}
              onSubmit={handleSubmit}
              placeholder="Type your instruction or '/' for commands..."
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};
