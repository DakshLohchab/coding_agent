import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const AVAILABLE_MODELS = ['openrouter', 'gemini', 'gpt', 'fireworks'];
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const OrchestratorUI = ({ eventBroker, actor, ioLayer, collisionDetector }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [chatLog, setChatLog] = useState<{ role: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentThought, setCurrentThought] = useState('');
  const [selectedModel, setSelectedModel] = useState('openrouter');
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [collision, setCollision] = useState<string | null>(null);

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

    const handleCollision = (path: string) => {
      setCollision(path);
      actor.send({ type: 'PAUSE_FOR_COLLISION', path });
    };
    collisionDetector?.on('collision', handleCollision);

    const handleIO = (msg: any) => {
      if (msg.type === 'collision_resolution') {
        setCollision(null);
        actor.send({ type: 'RESUME_FROM_COLLISION', resolution: msg.payload });
      }
    };
    ioLayer?.on('input', handleIO);

    return () => {
      eventBroker.off('agent.state_change', handleStateChange);
      eventBroker.off('agent.reply', handleReply);
      eventBroker.off('agent.thought', handleThought);
      collisionDetector?.off('collision', handleCollision);
      ioLayer?.off('input', handleIO);
    };
  }, [eventBroker, ioLayer, collisionDetector, actor]);

  useEffect(() => {
    if (isSubmitting) {
      const interval = setInterval(() => {
        setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isSubmitting]);

  useInput((input, key) => {
    if (key.return) {
      if (chatInput.trim().length > 0 && !isSubmitting && !collision) {
        setChatLog((log) => [...log, { role: 'user', text: chatInput.trim() }]);
        setIsSubmitting(true);
        setChatInput('');
        actor.send({ type: 'START', prompt: chatInput.trim(), model: selectedModel });
      }
    } else if (key.upArrow && !isSubmitting && !collision) {
      const currentIndex = AVAILABLE_MODELS.indexOf(selectedModel);
      setSelectedModel(AVAILABLE_MODELS[(currentIndex + AVAILABLE_MODELS.length - 1) % AVAILABLE_MODELS.length]);
    } else if (key.downArrow && !isSubmitting && !collision) {
      const currentIndex = AVAILABLE_MODELS.indexOf(selectedModel);
      setSelectedModel(AVAILABLE_MODELS[(currentIndex + 1) % AVAILABLE_MODELS.length]);
    } else if ((key.backspace || key.delete) && !collision) {
      setChatInput((prev) => prev.slice(0, -1));
    } else if (input && !collision) {
      setChatInput((prev) => prev + input);
    }
  });

  const getStatusText = () => {
    switch (stateValue) {
      case 'idle':
        return <Text color="gray">Idle</Text>;
      case 'architecting':
        return <Text color="blue">⚙️ Architecting...</Text>;
      case 'executing':
        return <Text color="cyan">💻 Executing code...</Text>;
      case 'verifying':
        return <Text color="yellow">🔬 Verifying...</Text>;
      case 'debating':
        return <Text color="magenta">🗣️ Debating...</Text>;
      case 'done':
        return <Text color="green">✅ Success</Text>;
      case 'failed':
        return <Text color="red">❌ Failed</Text>;
      default:
        return <Text color="white">{stateValue}</Text>;
    }
  };

  return (
    <Box flexDirection="column" minHeight={15} borderStyle="round" borderColor="cyan" padding={1}>
      {/* Top Panel: History */}
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="magenta">Chat Canvas</Text>
        <Box flexDirection="column" marginTop={1}>
          {chatLog.slice(-8).map((msg, index) => (
            <Text key={index}>
              <Text bold color={msg.role === 'user' ? 'green' : 'cyan'}>
                {msg.role === 'user' ? 'You: ' : 'Agent: '}
              </Text>
              {msg.text}
            </Text>
          ))}
          {chatLog.length === 0 && <Text color="gray">No history yet...</Text>}
        </Box>
      </Box>

      {/* Middle Panel: Live Status */}
      <Box borderStyle="single" borderColor="gray" padding={1} marginTop={1} marginBottom={1} flexDirection="column">
        <Box flexDirection="row">
          <Text bold>Status: </Text>
          {isSubmitting && <Text color="green">{SPINNER_FRAMES[spinnerFrame]} </Text>}
          {getStatusText()}
        </Box>
        <Box flexDirection="row" marginTop={1}>
          <Text bold>Model: </Text>
          <Text color="yellow">{selectedModel}</Text>
          <Text color="gray"> (↑/↓ to change)</Text>
        </Box>
        {currentThought && stateValue !== 'idle' && stateValue !== 'done' && stateValue !== 'failed' && (
          <Box marginTop={1}>
            <Text dimColor italic color="gray">
              💭 {currentThought}
            </Text>
          </Box>
        )}
        {collision && (
          <Box marginTop={1} borderStyle="single" borderColor="red" padding={1} flexDirection="column">
            <Text bold color="red">⚠️ IDE COLLISION DETECTED</Text>
            <Text color="yellow">{collision}</Text>
          </Box>
        )}
      </Box>

      {/* Bottom Panel: Input */}
      <Box flexDirection="row">
        <Text bold color="greenBright">❯ </Text>
        <Text>{chatInput || <Text color="gray">Type your prompt and press Enter...</Text>}</Text>
      </Box>
    </Box>
  );
};

