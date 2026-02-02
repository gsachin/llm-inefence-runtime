import { useEffect, useRef, useCallback, useState } from 'react'
import ReconnectingWebSocket from 'reconnecting-websocket'

// =============================================================================
// Types
// =============================================================================

export type DeployPhase = 'preflight' | 'values' | 'helm' | 'waiting'
export type PhaseStatus = 'started' | 'completed' | 'failed'

export interface PhaseMessage {
  type: 'phase'
  phase: DeployPhase
  status: PhaseStatus
}

export interface CheckMessage {
  type: 'check'
  name: string
  status: 'running' | 'passed' | 'failed'
  message?: string
}

export interface LogMessage {
  type: 'log'
  source: 'helm' | 'system'
  line: string
}

export interface CompleteMessage {
  type: 'complete'
  success: boolean
  endpoint?: string
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export type WSMessage = PhaseMessage | CheckMessage | LogMessage | CompleteMessage | ErrorMessage

export interface DeployConfig {
  profile: string
  release: string
  namespace?: string
  dry_run?: boolean
}

export interface UseDeployWebSocketOptions {
  onMessage?: (message: WSMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
}

export interface UseDeployWebSocketReturn {
  connect: (config: DeployConfig) => void
  disconnect: () => void
  isConnected: boolean
  isConnecting: boolean
  currentPhase: DeployPhase | null
  logs: string[]
  error: string | null
  isComplete: boolean
  isSuccess: boolean
}

// =============================================================================
// Hook
// =============================================================================

const WS_BASE_URL = import.meta.env.DEV ? 'ws://localhost:8000' : `ws://${window.location.host}`

export function useDeployWebSocket(options: UseDeployWebSocketOptions = {}): UseDeployWebSocketReturn {
  const wsRef = useRef<ReconnectingWebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [currentPhase, setCurrentPhase] = useState<DeployPhase | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: WSMessage = JSON.parse(event.data)
        options.onMessage?.(message)

        switch (message.type) {
          case 'phase':
            setCurrentPhase(message.phase)
            setLogs((prev) => [...prev, `[PHASE] ${message.phase}: ${message.status}`])
            break

          case 'check':
            setLogs((prev) => [...prev, `[CHECK] ${message.name}: ${message.status}${message.message ? ` - ${message.message}` : ''}`])
            break

          case 'log':
            setLogs((prev) => [...prev, message.line])
            break

          case 'complete':
            setIsComplete(true)
            setIsSuccess(message.success)
            setLogs((prev) => [...prev, message.success ? '[SUCCESS] Deployment complete!' : '[FAILED] Deployment failed'])
            if (message.endpoint) {
              setLogs((prev) => [...prev, `[INFO] Endpoint: ${message.endpoint}`])
            }
            break

          case 'error':
            setError(message.message)
            setLogs((prev) => [...prev, `[ERROR] ${message.message}`])
            break
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    },
    [options]
  )

  const connect = useCallback(
    (config: DeployConfig) => {
      // Reset state
      setLogs([])
      setError(null)
      setIsComplete(false)
      setIsSuccess(false)
      setCurrentPhase(null)
      setIsConnecting(true)

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close()
      }

      // Build WebSocket URL
      const wsUrl = `${WS_BASE_URL}/api/v1/deploy/ws/deploy`

      // Create reconnecting WebSocket
      wsRef.current = new ReconnectingWebSocket(wsUrl, [], {
        maxRetries: 10,
        minReconnectionDelay: 1000,
        maxReconnectionDelay: 30000,
        reconnectionDelayGrowFactor: 1.5,
      })

      wsRef.current.onopen = () => {
        setIsConnected(true)
        setIsConnecting(false)
        options.onOpen?.()

        // Send deploy config
        wsRef.current?.send(
          JSON.stringify({
            profile: config.profile,
            release: config.release,
            namespace: config.namespace ?? 'llm',
            dry_run: config.dry_run ?? false,
          })
        )
      }

      wsRef.current.onclose = () => {
        setIsConnected(false)
        setIsConnecting(false)
        options.onClose?.()
      }

      wsRef.current.onerror = () => {
        setIsConnecting(false)
        options.onError?.(new Event('error'))
      }

      wsRef.current.onmessage = handleMessage
    },
    [handleMessage, options]
  )

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
    setIsConnecting(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return {
    connect,
    disconnect,
    isConnected,
    isConnecting,
    currentPhase,
    logs,
    error,
    isComplete,
    isSuccess,
  }
}
