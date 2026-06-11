import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export const OrchestratorUI = ({ ioLayer, collisionDetector, eventBroker, actor }: any) => {
  const [stateValue, setStateValue] = useState('idle');
  const [collision, setCollision] = useState<string | null>(null);

  useEffect(() => {
    // 1. Subscribe to asynchronous, non-blocking EventBroker
    const handleStateChange = (state: string) => {
      setStateValue(state);
    };
    eventBroker.on('agent.state_change', handleStateChange);

    // 2. Active Collision Watcher Integration
    const handleCollision = (path: string) => {
      setCollision(path);
      actor.send({ type: 'PAUSE_FOR_COLLISION', path });
    };
    collisionDetector.on('collision', handleCollision);

    // 3. I/O Input handling
    const handleIO = (msg: any) => {
      if (msg.type === 'collision_resolution') {
        setCollision(null);
        actor.send({ type: 'RESUME_FROM_COLLISION', resolution: msg.payload });
      }
    };
    ioLayer.on('input', handleIO);

    return () => {
      eventBroker.off('agent.state_change', handleStateChange);
      collisionDetector.off('collision', handleCollision);
      ioLayer.off('input', handleIO);
    };
  }, [eventBroker, collisionDetector, ioLayer, actor]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
        <Text bold color="cyan">Agent Orchestrator Daemon</Text>
        <Text>Status: <Text color={stateValue === 'idle' ? 'gray' : 'green'}>{stateValue.toUpperCase()}</Text></Text>
        
        {collision && (
          <Box marginTop={1} padding={1} borderStyle="single" borderColor="red" flexDirection="column">
            <Text bold color="red">⚠️ IDE COLLISION DETECTED</Text>
            <Text color="yellow">User manually modified: {collision}</Text>
            <Text>State Machine paused. Awaiting I/O resolution (e.g., CLI or WebSocket input)...</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Parallel Execution Pipelines:</Text>
        <Text>Architect Agent: {stateValue === 'architecting' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
        <Text>Execution Agent: {stateValue === 'executing' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
        <Text>Verification Agent: {stateValue === 'verifying' ? <Text color="blue">Running...</Text> : 'Idle'}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="magenta">Intelligence Layer Interfaces:</Text>
        <Text color="gray">AST VectorStore [Online] | WebSockets [Port 8080] | Audio Hooks [Pending]</Text>
      </Box>
    </Box>
  );
};
