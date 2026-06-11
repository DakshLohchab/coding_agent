import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

const AVAILABLE_MODELS = ['openrouter', 'gemini', 'gpt', 'fireworks'];

export const OrchestratorUI = ({ ioLayer, collisionDetector, eventBroker, actor }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [collision, setCollision] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('openrouter');
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastAgentMessage, setLastAgentMessage] = useState<string>('Waiting for your prompt...');

  useEffect(() => {
    const handleStateChange = (state: string) => {
      setStateValue(state);
    };
    eventBroker.on('agent.state_change', handleStateChange);

    const handleAudioListening = (listening: boolean) => {
      setIsListening(listening);
    };
    eventBroker.on('audio.listening', handleAudioListening);

    const handleCollision = (path: string) => {
      setCollision(path);
      actor.send({ type: 'PAUSE_FOR_COLLISION', path });
    };
    collisionDetector.on('collision', handleCollision);

    const handleIO = (msg: any) => {
      if (msg.type === 'collision_resolution') {
        setCollision(null);
        actor.send({ type: 'RESUME_FROM_COLLISION', resolution: msg.payload });
      } else if (msg.type === 'prompt') {
        setChatLog((log) => [...log, `User: ${msg.payload}`]);
        setIsSubmitting(true);
        actor.send({ type: 'START', prompt: msg.payload, model: selectedModel });
      }
    };

    const handleReply = (message: string) => {
      setChatLog((log) => [...log, `Agent: ${message}`]);
      setLastAgentMessage(message);
      setIsSubmitting(false);
    };
    eventBroker.on('agent.reply', handleReply);
    ioLayer.on('input', handleIO);

    return () => {
      eventBroker.off('agent.state_change', handleStateChange);
      eventBroker.off('audio.listening', handleAudioListening);
      collisionDetector.off('collision', handleCollision);
      ioLayer.off('input', handleIO);
      eventBroker.off('agent.reply', handleReply);
    };
  }, [eventBroker, collisionDetector, ioLayer, actor, selectedModel]);

  useInput((input, key) => {
    if (key.return) {
      if (chatInput.trim().length > 0 && !isSubmitting) {
        const prompt = chatInput.trim();
        setChatLog((log) => [...log, `User: ${prompt}`]);
        setIsSubmitting(true);
        setLastAgentMessage('Submitting prompt to the orchestrator...');
        actor.send({ type: 'START', prompt, model: selectedModel });
        setChatInput('');
      }
    } else if (key.upArrow) {
      const currentIndex = AVAILABLE_MODELS.indexOf(selectedModel);
      setSelectedModel(AVAILABLE_MODELS[(currentIndex + AVAILABLE_MODELS.length - 1) % AVAILABLE_MODELS.length]);
    } else if (key.downArrow) {
      const currentIndex = AVAILABLE_MODELS.indexOf(selectedModel);
      setSelectedModel(AVAILABLE_MODELS[(currentIndex + 1) % AVAILABLE_MODELS.length]);
    } else if (key.backspace || key.delete) {
      setChatInput((prev) => prev.slice(0, -1));
    } else if (input) {
      setChatInput((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
        <Text bold color="cyan">Agent Orchestrator Daemon</Text>
        <Text>Status: <Text color={stateValue === 'idle' ? 'gray' : 'green'}>{stateValue.toUpperCase()}</Text></Text>
        <Text>LLM Model: <Text color="yellow">{selectedModel}</Text> <Text color="gray">(Use ↑/↓ to switch)</Text></Text>
        <Text>Chat Prompt: <Text color="gray">Type and press Enter to submit</Text></Text>
        <Text>{chatInput || <Text color="gray">Type your prompt here...</Text>}</Text>

        {isListening && (
          <Box marginTop={1}>
            <Text bold color="greenBright">🎙️ Listening... (Receiving PCM Audio Stream)</Text>
          </Box>
        )}

        {collision && (
          <Box marginTop={1} padding={1} borderStyle="single" borderColor="red" flexDirection="column">
            <Text bold color="red">⚠️ IDE COLLISION DETECTED</Text>
            <Text color="yellow">User manually modified: {collision}</Text>
            <Text>State Machine paused. Awaiting I/O resolution...</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Parallel Execution Pipelines:</Text>
        <Text>Architect Agent: {stateValue === 'architecting' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
        <Text>Execution Agent: {stateValue === 'executing' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
        <Text>Verification Agent: {stateValue === 'verifying' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
        <Text>Debate Agent: {stateValue === 'debating' ? <Text color="magenta">Debating...</Text> : 'Idle'}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="magenta">Conversation</Text>
        {chatLog.slice(-6).map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
        <Text color="gray">{lastAgentMessage}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="magenta">Intelligence Layer Interfaces:</Text>
        <Text color="gray">AST VectorStore [Online] | WebSockets [Port 8080] | Audio Pipeline [Online]</Text>
      </Box>
    </Box>
  );
};
