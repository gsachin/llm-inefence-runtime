import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useDeployWebSocket, DeployPhase } from '../../api/ws'
import { getState, setState, clearState } from '../../state/wizardState'
import { 
  Rocket, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Terminal,
  Copy,
  Download,
  StopCircle,
  RefreshCw
} from 'lucide-react'

// =============================================================================
// Components
// =============================================================================

const PHASES: { id: DeployPhase; label: string }[] = [
  { id: 'preflight', label: 'Preflight Checks' },
  { id: 'values', label: 'Generating Config' },
  { id: 'helm', label: 'Helm Deploy' },
  { id: 'waiting', label: 'Waiting for Ready' },
]

function PhaseIndicator({ currentPhase, isComplete, isSuccess }: { 
  currentPhase: DeployPhase | null
  isComplete: boolean
  isSuccess: boolean 
}) {
  const currentIndex = currentPhase ? PHASES.findIndex((p) => p.id === currentPhase) : -1

  return (
    <div className="flex items-center justify-between mb-6">
      {PHASES.map((phase, index) => {
        const isPast = index < currentIndex
        const isCurrent = index === currentIndex

        let statusClass = 'border-muted-foreground/30 text-muted-foreground'
        let icon = <span className="text-sm">{index + 1}</span>

        if (isPast || (isComplete && isSuccess)) {
          statusClass = 'border-success bg-success text-success-foreground'
          icon = <CheckCircle2 className="w-4 h-4" />
        } else if (isCurrent && !isComplete) {
          statusClass = 'border-primary bg-primary text-primary-foreground'
          icon = <Loader2 className="w-4 h-4 animate-spin" />
        } else if (isComplete && !isSuccess && isCurrent) {
          statusClass = 'border-destructive bg-destructive text-destructive-foreground'
          icon = <XCircle className="w-4 h-4" />
        }

        return (
          <div key={phase.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${statusClass}`}>
                {icon}
              </div>
              <span className="text-xs mt-1 text-muted-foreground">{phase.label}</span>
            </div>
            {index < PHASES.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${isPast ? 'bg-success' : 'bg-muted-foreground/30'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function LogViewer({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
      setAutoScroll(isAtBottom)
    }
  }

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'))
  }

  const downloadLogs = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `deploy-${Date.now()}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-[#0d1117] rounded-lg overflow-hidden border border-border">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Terminal className="w-4 h-4" />
          <span>Deployment Logs</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyLogs}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
            title="Copy logs"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={downloadLogs}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
            title="Download logs"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-80 overflow-auto p-3 font-mono text-xs log-viewer"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground">Waiting for logs...</p>
        ) : (
          logs.map((line, index) => {
            let className = 'log-line'
            if (line.includes('[ERROR]') || line.includes('[FAILED]')) {
              className += ' log-error'
            } else if (line.includes('[WARNING]') || line.includes('⚠')) {
              className += ' log-warning'
            } else if (line.includes('[SUCCESS]') || line.includes('[✓]')) {
              className += ' log-success'
            }

            return (
              <div key={index} className={className}>
                {line}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function DeployStep() {
  const navigate = useNavigate()
  const [releaseName, setReleaseName] = useState('')
  const [hasStarted, setHasStarted] = useState(false)

  // Get selected profile from state
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)

  useEffect(() => {
    getState('selectedProfile').then(setSelectedProfile)
    getState('currentRelease').then((r) => {
      if (r) setReleaseName(r)
    })
    getState('deployInProgress').then((inProgress) => {
      if (inProgress) setHasStarted(true)
    })
  }, [])

  // WebSocket connection
  const {
    connect,
    disconnect,
    isConnected,
    isConnecting,
    currentPhase,
    logs,
    error,
    isComplete,
    isSuccess,
  } = useDeployWebSocket({
    onOpen: () => {
      setState('deployInProgress', true)
    },
    onMessage: (msg) => {
      if (msg.type === 'complete') {
        setState('deployInProgress', false)
      }
    },
  })

  // Fetch profile details
  const { data: profile } = useQuery({
    queryKey: ['profile', selectedProfile],
    queryFn: () => api.getProfile(selectedProfile!),
    enabled: !!selectedProfile,
  })

  const handleStartDeploy = () => {
    if (!selectedProfile) return

    // Generate release name if not set
    const release = releaseName || `llm-${selectedProfile.replace(/_/g, '-')}`
    setReleaseName(release)
    setState('currentRelease', release)

    setHasStarted(true)
    connect({
      profile: selectedProfile,
      release: release,
      namespace: 'llm',
      dry_run: false,
    })
  }

  const handleCancel = () => {
    disconnect()
    api.destroyAll().then(() => {
      clearState('deployInProgress')
      clearState('currentRelease')
      setHasStarted(false)
    })
  }

  const handleRetry = () => {
    setHasStarted(false)
  }

  const handleGoToDashboard = () => {
    navigate('/step/dashboard')
  }

  // No profile selected
  if (!selectedProfile) {
    return (
      <div className="text-center py-16">
        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Profile Selected</h2>
        <p className="text-muted-foreground mb-4">
          Please go back and select a model profile first.
        </p>
        <button
          onClick={() => navigate('/step/profile')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          Select Profile
        </button>
      </div>
    )
  }

  // Pre-deploy view
  if (!hasStarted) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Deploy Model</h1>
          <p className="text-muted-foreground">
            Ready to deploy <strong>{selectedProfile}</strong> to your cluster.
          </p>
        </div>

        {/* Release name input */}
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div>
            <label htmlFor="release-name" className="block text-sm font-medium mb-2">
              Release Name
            </label>
            <input
              id="release-name"
              type="text"
              value={releaseName}
              onChange={(e) => setReleaseName(e.target.value)}
              placeholder={`llm-${selectedProfile.replace(/_/g, '-')}`}
              className="w-full px-4 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">
              A unique name for this deployment (auto-generated if left empty)
            </p>
          </div>

          {/* Model info */}
          {profile && (
            <div className="text-sm text-muted-foreground">
              <p>Model: <code className="bg-muted px-1 rounded">{String(profile.model)}</code></p>
            </div>
          )}
        </div>

        {/* Deploy button */}
        <button
          onClick={handleStartDeploy}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <Rocket className="w-5 h-5" />
          Start Deployment
        </button>
      </div>
    )
  }

  // Deploying view
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">
          {isComplete ? (isSuccess ? 'Deployment Complete!' : 'Deployment Failed') : 'Deploying...'}
        </h1>
        <p className="text-muted-foreground">
          {isComplete
            ? isSuccess
              ? `Successfully deployed ${selectedProfile}`
              : 'The deployment encountered an error. Check the logs below.'
            : `Deploying ${selectedProfile} to your cluster...`}
        </p>
      </div>

      {/* Phase indicator */}
      <PhaseIndicator currentPhase={currentPhase} isComplete={isComplete} isSuccess={isSuccess} />

      {/* Log viewer */}
      <LogViewer logs={logs} />

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        {!isComplete ? (
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
          >
            <StopCircle className="w-4 h-4" />
            Cancel & Destroy
          </button>
        ) : isSuccess ? (
          <button
            onClick={handleGoToDashboard}
            className="flex items-center gap-2 px-4 py-2 bg-success text-success-foreground rounded-md hover:bg-success/90"
          >
            <CheckCircle2 className="w-4 h-4" />
            Go to Dashboard
          </button>
        ) : (
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        )}

        {/* Connection status */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isConnecting && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting...
            </>
          )}
          {isConnected && !isComplete && (
            <>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Connected
            </>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}
    </div>
  )
}
