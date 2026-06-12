import { useEffect, useRef, useState, useCallback } from 'react';

interface Message {
  type: string;
  payload: unknown;
  timestamp: number;
}

export function useBroadcastChannel(channelName: string) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<Message | null>(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(channelName);
    setIsConnected(true);

    channelRef.current.onmessage = (event) => {
      setLastMessage(event.data);
    };


    return () => {
      channelRef.current?.close();
    };
  }, [channelName]);

  const sendMessage = useCallback((type: string, payload: unknown) => {
    const message: Message = {
      type,
      payload,
      timestamp: Date.now(),
    };
    channelRef.current?.postMessage(message);
  }, []);

  return { sendMessage, lastMessage, isConnected };
}
