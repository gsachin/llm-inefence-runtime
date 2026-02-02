import { useState, useEffect, useRef, useCallback } from 'react'
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
  RefreshCw,
  Server,
  Cpu
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

// Ollama deployment phases
const OLLAMA_PHASES = [
  { id: 'checking', label: 'Checking Ollama' },
  { id: 'pulling', label: 'Pulling Model' },
  { id: 'loading', label: 'Loading Model' },
  { id: 'ready', label: 'Ready to Chat' },
]

const OLLAMA_WS_BASE_URL = import.meta.env.DEV ? 'ws://localhost:8000' : `ws://${window.location.host}`

type OllamaPhase = 'checking' | 'pulling' | 'loading' | 'ready' | null

function OllamaPhaseIndicator({ currentPhase, isComplete, isSuccess }: { 
  currentPhase: OllamaPhase
  isComplete: boolean
  isSuccess: boolean 
}) {
  const currentIndex = currentPhase ? OLLAMA_PHASES.findIndex((p) => p.id === currentPhase) : -1

  return (
    <div className="flex items-center justify-between mb-6">
      {OLLAMA_PHASES.map((phase, index) => {
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
            {index < OLLAMA_PHASES.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${isPast ? 'bg-success' : 'bg-muted-foreground/30'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

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

  // Get selected profile and runtime from state
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<'vllm' | 'ollama' | ''>('')
  
  // Ollama-specific state
  const [ollamaPhase, setOllamaPhase] = useState<OllamaPhase>(null)
  const [ollamaLogs, setOllamaLogs] = useState<string[]>([])
  const [ollamaComplete, setOllamaComplete] = useState(false)
  const [ollamaSuccess, setOllamaSuccess] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | null>(null)

  useEffect(() => {
    getState('selectedProfile').then(setSelectedProfile)
    getState('selectedModel').then(setSelectedModel)
    getState('runtime').then((r) => setRuntime(r || ''))
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

  // Ollama deployment handler
  const deployOllamaModel = useCallback(async (modelName: string) => {
    setOllamaLogs([])
    setOllamaComplete(false)
    setOllamaSuccess(false)
    setOllamaError(null)
    setState('deployInProgress', true)

    const addLog = (msg: string) => {
      setOllamaLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
    }

    try {
      // Phase 1: Check Ollama status
      setOllamaPhase('checking')
      addLog('Checking Ollama server status...')
      
      const status = await api.getOllamaStatus()
      if (!status.running) {
        throw new Error('Ollama server is not running. Please start Ollama first.')
      }
      addLog(`✓ Ollama ${status.version} is running`)
      if (status.gpu_available) {
        addLog(`✓ GPU detected: ${status.gpu_info}`)
      }

      // Check if model is already downloaded
      const existingModels = await api.listOllamaModels()
      const isAlreadyPulled = existingModels.some((m) => 
        m.name === modelName || m.name.startsWith(`${modelName}:`)
      )

      // Phase 2: Pull model if needed
      setOllamaPhase('pulling')
      if (isAlreadyPulled) {
        addLog(`✓ Model ${modelName} is already downloaded`)
      } else {
        addLog(`Pulling model ${modelName}...`)
        addLog('This may take a while depending on model size and network speed.')

        const pullWithWebSocket = () => {
          return new Promise<{ success: boolean; message: string }>((resolve, reject) => {
            const wsUrl = `${OLLAMA_WS_BASE_URL}/api/v1/ollama/ws/pull`
            const ws = new WebSocket(wsUrl)

            let lastStatus = ''
            let lastPercent = -1

            ws.onopen = () => {
              ws.send(JSON.stringify({ model: modelName }))
            }

            ws.onerror = () => {
              ws.close()
              reject(new Error('WebSocket error during pull'))
            }

            ws.onmessage = (event) => {
              try {
                const msg = JSON.parse(event.data)

                if (msg.type === 'started') {
                  addLog(`Started pulling ${msg.model}`)
                }

                if (msg.type === 'pull_progress') {
                  const status = msg.status || ''
                  const completed = Number(msg.completed || 0)
                  const total = Number(msg.total || 0)

                  if (status && status !== lastStatus) {
                    lastStatus = status
                    addLog(status)
                  }

                  if (total > 0) {
                    const percent = Math.floor((completed / total) * 100)
                    if (percent !== lastPercent && percent % 5 === 0) {
                      lastPercent = percent
                      addLog(`Download progress: ${percent}%`)
                    }
                  }
                }

                if (msg.type === 'completed') {
                  ws.close()
                  resolve({ success: true, message: msg.message || 'completed' })
                }

                if (msg.type === 'error') {
                  ws.close()
                  resolve({ success: false, message: msg.message || 'Unknown error' })
                }
              } catch (e) {
                ws.close()
                reject(e)
              }
            }
          })
        }

        let pullResult
        try {
          pullResult = await pullWithWebSocket()
        } catch (e) {
          addLog('[WARNING] WebSocket pull failed, retrying with HTTP...')
          pullResult = await api.pullOllamaModel(modelName)
        }

        if (pullResult.success) {
          addLog(`✓ Successfully pulled ${modelName}`)
        } else {
          throw new Error(`Failed to pull model: ${pullResult.message || 'Unknown error'}`)
        }
      }

      // Phase 3: Load model (warm up)
      setOllamaPhase('loading')
      addLog(`Loading model ${modelName} into GPU memory...`)
      
      // Make a simple generate call to warm up the model
      try {
        await api.generateOllamaText(modelName, 'Hello')
        addLog(`✓ Model ${modelName} loaded and ready`)
      } catch (e) {
        addLog(`[WARNING] Model warmup failed, but model may still work: ${e}`)
      }

      // Phase 4: Ready
      setOllamaPhase('ready')
      addLog('')
      addLog('═══════════════════════════════════════════════')
      addLog(`✓ SUCCESS: ${modelName} is ready for inference!`)
      addLog('═══════════════════════════════════════════════')
      addLog('')
      addLog('You can now chat with your model using:')
      addLog(`  curl http://localhost:11434/api/generate -d '{"model":"${modelName}","prompt":"Hello"}'`)
      addLog('')
      addLog('Or use the OpenAI-compatible API:')
      addLog(`  curl http://localhost:11434/v1/chat/completions \\`)
      addLog(`    -H "Content-Type: application/json" \\`)
      addLog(`    -d '{"model":"${modelName}","messages":[{"role":"user","content":"Hello"}]}'`)

      setOllamaComplete(true)
      setOllamaSuccess(true)
      setState('deployInProgress', false)

    } catch (error: any) {
      const errorMsg = error.message || String(error)
      addLog(`[ERROR] ${errorMsg}`)
      setOllamaError(errorMsg)
      setOllamaComplete(true)
      setOllamaSuccess(false)
      setState('deployInProgress', false)
    }
  }, [])

  const handleStartDeploy = () => {
    if (!selectedProfile) return

    // Generate release name if not set
    const release = releaseName || `llm-${selectedProfile.replace(/_/g, '-')}`
    setReleaseName(release)
    setState('currentRelease', release)

    setHasStarted(true)

    // Use Ollama for dgx_spark profile or any profile with runtime: ollama
    if (runtime === 'ollama' && selectedModel) {
      deployOllamaModel(selectedModel)
    } else {
      // Use traditional Helm/KServe deployment
      connect({
        profile: selectedProfile,
        release: release,
        namespace: 'llm',
        dry_run: false,
      })
    }
  }

  const handleCancel = () => {
    if (runtime === 'ollama') {
      // For Ollama, just reset the state
      clearState('deployInProgress')
      clearState('currentRelease')
      setHasStarted(false)
      setOllamaPhase(null)
      setOllamaLogs([])
      setOllamaComplete(false)
      setOllamaSuccess(false)
      setOllamaError(null)
    } else {
      disconnect()
      api.destroyAll().then(() => {
        clearState('deployInProgress')
        clearState('currentRelease')
        setHasStarted(false)
      })
    }
  }

  const handleRetry = () => {
    setHasStarted(false)
    setOllamaPhase(null)
    setOllamaLogs([])
    setOllamaComplete(false)
    setOllamaSuccess(false)
    setOllamaError(null)
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
            Ready to deploy <strong>{selectedModel || selectedProfile}</strong>
            {runtime === 'ollama' ? ' via Ollama' : ' to your cluster'}.
          </p>
        </div>

        {/* Runtime indicator */}
        {runtime === 'ollama' && (
          <div className="bg-success/10 border border-success/30 rounded-lg p-4 flex items-center gap-3">
            <Server className="w-5 h-5 text-success" />
            <div>
              <p className="font-medium text-success">Ollama Runtime</p>
              <p className="text-sm text-muted-foreground">
                Using native GPU acceleration via Ollama on localhost:11434
              </p>
            </div>
          </div>
        )}

        {/* Release name input (only for Helm deployments) */}
        {runtime !== 'ollama' && (
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
                placeholder={`llm-${selectedProfile?.replace(/_/g, '-')}`}
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
        )}

        {/* Model info for Ollama */}
        {runtime === 'ollama' && selectedModel && (
          <div className="bg-card border border-border rounded-lg p-6 space-y-3">
            <h3 className="font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Model Details
            </h3>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Model: <code className="bg-muted px-1 rounded">{selectedModel}</code></p>
              <p className="text-xs">
                The model will be pulled from the Ollama registry if not already downloaded.
              </p>
            </div>
          </div>
        )}

        {/* Deploy button */}
        <button
          onClick={handleStartDeploy}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <Rocket className="w-5 h-5" />
          {runtime === 'ollama' ? 'Pull & Deploy Model' : 'Start Deployment'}
        </button>
      </div>
    )
  }

  // Deploying view
  const deployComplete = runtime === 'ollama' ? ollamaComplete : isComplete
  const deploySuccess = runtime === 'ollama' ? ollamaSuccess : isSuccess
  const deployLogs = runtime === 'ollama' ? ollamaLogs : logs
  const deployError = runtime === 'ollama' ? ollamaError : error

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">
          {deployComplete ? (deploySuccess ? 'Deployment Complete!' : 'Deployment Failed') : 'Deploying...'}
        </h1>
        <p className="text-muted-foreground">
          {deployComplete
            ? deploySuccess
              ? `Successfully deployed ${selectedModel || selectedProfile}`
              : 'The deployment encountered an error. Check the logs below.'
            : `Deploying ${selectedModel || selectedProfile}...`}
        </p>
      </div>

      {/* Phase indicator */}
      {runtime === 'ollama' ? (
        <OllamaPhaseIndicator currentPhase={ollamaPhase} isComplete={ollamaComplete} isSuccess={ollamaSuccess} />
      ) : (
        <PhaseIndicator currentPhase={currentPhase} isComplete={isComplete} isSuccess={isSuccess} />
      )}

      {/* Log viewer */}
      <LogViewer logs={deployLogs} />

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        {!deployComplete ? (
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
          >
            <StopCircle className="w-4 h-4" />
            Cancel
          </button>
        ) : deploySuccess ? (
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
          {runtime === 'ollama' ? (
            ollamaPhase && !ollamaComplete && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            )
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Error display */}
      {deployError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
          <p className="text-destructive text-sm">{deployError}</p>
        </div>
      )}
    </div>
  )
}
