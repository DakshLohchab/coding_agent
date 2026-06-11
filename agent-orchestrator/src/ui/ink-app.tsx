import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

export const OrchestratorUI = ({ eventBroker, actor }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [chatLog, setChatLog] = useState<{ role: string, text: string, summary?: any }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentThought, setCurrentThought] = useState('');

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

  const handleSubmit = (query: string) => {
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
      case 'architecting': return <Text color="blue">⚙️ Architecting...</Text>;
      case 'executing': return <Text color="cyan">💻 Executing code diffs...</Text>;
      case 'verifying': return <Text color="yellow">🔬 Verifying code...</Text>;
      case 'debating': return <Text color="magenta">🗣️ Debating plan...</Text>;
      case 'done': return <Text color="green">✅ Success</Text>;
      case 'failed': return <Text color="red">❌ Failed</Text>;
      default: return <Text color="white">{stateValue}</Text>;
    }
  };

  return (
    <Box flexDirection="column" minHeight={15} borderStyle="round" borderColor="cyan" padding={1}>
      {/* Top Panel: History */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <Text bold color="magenta">Chat Canvas</Text>
        <Box flexDirection="column" marginTop={1}>
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
            return (
              <Text key={index}>
                <Text bold color={msg.role === 'user' ? 'green' : 'cyan'}>
                  {msg.role === 'user' ? 'You: ' : 'Agent: '}
                </Text>
                {msg.text}
              </Text>
            );
          })}
          {chatLog.length === 0 && <Text color="gray">No history yet...</Text>}
        </Box>
      </Box>

      {/* Middle Panel: Live Status */}
      <Box borderStyle="single" borderColor="gray" padding={1} marginTop={1} marginBottom={1} flexDirection="column">
        <Box flexDirection="row">
          <Text bold>Status: </Text>
          {isSubmitting && <Text color="green"><Spinner type="dots" /> </Text>}
          {getStatusText()}
        </Box>
        {currentThought && stateValue !== 'idle' && stateValue !== 'done' && (
          <Box marginTop={1}>
            <Text dimColor italic color="gray">💭 {currentThought}</Text>
          </Box>
        )}
      </Box>

      {/* Bottom Panel: Input */}
      <Box flexDirection="row">
        <Text bold color="greenBright">❯ </Text>
        <TextInput
          value={chatInput}
          onChange={setChatInput}
          onSubmit={handleSubmit}
          placeholder="Type your prompt here and press Enter..."
        />
      </Box>
    </Box>
  );
};
