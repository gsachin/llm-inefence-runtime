import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, DependencyInfo } from '../../api/client'
import { setState } from '../../state/wizardState'
import { SudoPasswordModal } from './SudoPasswordModal'
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
  Square,
  Terminal as TerminalIcon,
  Clock,
  Server,
  Wrench,
  Lock
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

interface InstallProgress {
  dependency: string
  state: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  message: string
  output?: string
}

interface PasswordRequiredMessage {
  type: 'password_required'
  dependency: string
  attempts_remaining: number
}

interface PasswordInvalidMessage {
  type: 'password_invalid'
  dependency: string
  attempts_remaining: number
}

interface ProgressMessage {
  type: 'progress'
  data: InstallProgress
}

interface CompleteMessage {
  type: 'complete'
  data: { 
    success: boolean
    installed: string[]
    failed: string[]
    skipped: string[] 
  }
}

interface ErrorMessage {
  type: 'error'
  message: string
}

type WebSocketMessage = 
  | PasswordRequiredMessage 
  | PasswordInvalidMessage 
  | ProgressMessage 
  | CompleteMessage 
  | ErrorMessage

// =============================================================================
// Status Icon Component
// =============================================================================

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'installed':
      return <CheckCircle2 className="w-5 h-5 text-success" />
    case 'outdated':
      return <AlertTriangle className="w-5 h-5 text-warning" />
    case 'missing':
      return <XCircle className="w-5 h-5 text-destructive" />
    case 'optional_missing':
      return <AlertTriangle className="w-5 h-5 text-muted-foreground" />
    case 'check_failed':
      return <AlertTriangle className="w-5 h-5 text-muted-foreground" />
    case 'pending_cluster':
      return <Clock className="w-5 h-5 text-blue-500" />
    default:
      return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
  }
}

// =============================================================================
// Dependency Card Component
// =============================================================================

interface DependencyCardProps {
  dep: DependencyInfo
  isInstalling: boolean
  installProgress?: InstallProgress
  onInstall: (name: string) => void
}

function DependencyCard({ dep, isInstalling, installProgress, onInstall }: DependencyCardProps) {
  const [expanded, setExpanded] = useState(false)
  
  const isRunning = installProgress?.dependency === dep.name && installProgress.state === 'running'
  const justCompleted = installProgress?.dependency === dep.name && 
    (installProgress.state === 'success' || installProgress.state === 'failed')
  const isPendingCluster = dep.status === 'pending_cluster'

  return (
    <div 
      className={`
        border rounded-lg p-4 transition-all
        ${dep.status === 'installed' ? 'border-success/30 bg-success/5' : ''}
        ${dep.status === 'missing' ? 'border-destructive/30 bg-destructive/5' : ''}
        ${dep.status === 'outdated' ? 'border-warning/30 bg-warning/5' : ''}
        ${isPendingCluster ? 'border-blue-500/30 bg-blue-500/5' : ''}
        ${isRunning ? 'border-primary ring-2 ring-primary/20' : ''}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <StatusIcon status={isRunning ? 'running' : justCompleted ? installProgress?.state || dep.status : dep.status} />
          
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{dep.name}</h3>
              {dep.optional && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Optional
                </span>
              )}
              {isPendingCluster && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-500">
                  Pending Cluster
                </span>
              )}
            </div>
            
            <p className="text-sm text-muted-foreground mt-0.5">
              {dep.description}
            </p>
            
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span>Required: {dep.required_version}</span>
              {dep.installed_version && (
                <span>Installed: {dep.installed_version}</span>
              )}
              {dep.docs_url && (
                <a 
                  href={dep.docs_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  Docs <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            
            {/* Status Message */}
            {(dep.message || installProgress?.message) && (
              <p className={`text-sm mt-2 ${
                dep.status === 'installed' ? 'text-success' : 
                dep.status === 'missing' ? 'text-destructive' : 
                isPendingCluster ? 'text-blue-500' :
                'text-muted-foreground'
              }`}>
                {isRunning ? installProgress?.message : dep.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Install button - only show for missing/outdated CLI tools */}
          {(dep.status === 'missing' || dep.status === 'outdated') && !isPendingCluster && (
            <button
              onClick={() => onInstall(dep.name)}
              disabled={isInstalling}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                transition-colors
                ${isInstalling 
                  ? 'bg-muted text-muted-foreground cursor-not-allowed' 
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }
              `}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Install
                </>
              )}
            </button>
          )}
          
          {/* Expand for details */}
          {(dep.install_cmd || installProgress?.output) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded hover:bg-muted transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <TerminalIcon className="w-3 h-3" />
            Install command:
          </div>
          <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
            {dep.requires_sudo && <span className="text-warning">sudo </span>}
            {dep.install_cmd}
          </pre>
          
          {installProgress?.output && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <TerminalIcon className="w-3 h-3" />
                Output:
              </div>
              <pre className="bg-black text-green-400 p-3 rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">
                {installProgress.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function DependencyStep() {
  const queryClient = useQueryClient()
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({})
  const [installLog, setInstallLog] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  
  // Sudo password modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordDependency, setPasswordDependency] = useState<string>('')
  const [attemptsRemaining, setAttemptsRemaining] = useState(3)
  const [isPasswordInvalid, setIsPasswordInvalid] = useState(false)
  const [isValidatingPassword, setIsValidatingPassword] = useState(false)
  
  // Fetch dependency status
  const { 
    data: statusData, 
    isLoading, 
    error,
    refetch 
  } = useQuery({
    queryKey: ['deps-status'],
    queryFn: () => api.getDependencyStatus(),
    staleTime: 30_000,
  })
  
  // Submit password to WebSocket
  const submitPassword = useCallback((password: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setIsValidatingPassword(true)
      wsRef.current.send(JSON.stringify({
        action: 'submit_password',
        password,
      }))
    }
  }, [])
  
  // Close password modal
  const closePasswordModal = useCallback(() => {
    setShowPasswordModal(false)
    setIsPasswordInvalid(false)
    setIsValidatingPassword(false)
    // Cancel installation if password modal is closed
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel' }))
    }
  }, [])

  // Handle WebSocket installation
  const startInstallation = useCallback((dependencies?: string[]) => {
    const wsUrl = import.meta.env.DEV 
      ? 'ws://localhost:8000/api/v1/deps/ws/install'
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/deps/ws/install`
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    
    ws.onopen = () => {
      setInstalling(true)
      setProgress({})
      setInstallLog([])
      
      // Send start message
      ws.send(JSON.stringify({
        action: 'start',
        dependencies,
        skip_optional: true,
      }))
    }
    
    ws.onmessage = (event) => {
      const msg: WebSocketMessage = JSON.parse(event.data)
      
      if (msg.type === 'password_required') {
        // Show password modal
        setPasswordDependency(msg.dependency)
        setAttemptsRemaining(msg.attempts_remaining)
        setIsPasswordInvalid(false)
        setIsValidatingPassword(false)
        setShowPasswordModal(true)
      } else if (msg.type === 'password_invalid') {
        // Show error and allow retry
        setPasswordDependency(msg.dependency)
        setAttemptsRemaining(msg.attempts_remaining)
        setIsPasswordInvalid(true)
        setIsValidatingPassword(false)
        // Modal stays open for retry
      } else if (msg.type === 'progress') {
        const progressData = msg.data
        
        // Close password modal on successful progress after password submission
        if (progressData.state === 'running' && showPasswordModal) {
          setShowPasswordModal(false)
          setIsPasswordInvalid(false)
          setIsValidatingPassword(false)
        }
        
        setProgress(prev => ({
          ...prev,
          [progressData.dependency]: progressData,
        }))
        
        if (progressData.output) {
          setInstallLog(prev => [...prev, progressData.output!])
        }
      } else if (msg.type === 'complete') {
        setInstalling(false)
        setShowPasswordModal(false)
        setIsPasswordInvalid(false)
        setIsValidatingPassword(false)
        // Refresh status
        queryClient.invalidateQueries({ queryKey: ['deps-status'] })
      } else if (msg.type === 'error') {
        setInstalling(false)
        setShowPasswordModal(false)
        setIsPasswordInvalid(false)
        setIsValidatingPassword(false)
        console.error('Installation error:', msg.message)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setInstalling(false)
    }
    
    ws.onclose = () => {
      setInstalling(false)
      wsRef.current = null
    }
  }, [queryClient])

  // Cancel installation
  const cancelInstallation = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel' }))
    }
  }, [])

  // Install single dependency
  const installOne = useCallback((name: string) => {
    startInstallation([name])
  }, [startInstallation])

  // Install all missing
  const installAllMissing = useCallback(() => {
    if (!statusData) return
    // Only install CLI tools that are missing (not cluster components)
    const missing = statusData.cli_tools
      .filter(d => d.status === 'missing' || d.status === 'outdated')
      .map(d => d.name)
    
    if (missing.length > 0) {
      startInstallation(missing)
    }
  }, [statusData, startInstallation])

  // Save progress state - user can proceed once CLI tools are satisfied
  useEffect(() => {
    if (statusData?.cli_tools_satisfied) {
      setState('dependenciesReady', true)
    }
  }, [statusData])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-muted-foreground">Checking dependencies...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <XCircle className="w-8 h-8 mx-auto text-destructive" />
          <p className="mt-4 text-destructive">Failed to check dependencies</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Count CLI tool issues only
  const cliMissingCount = statusData?.cli_tools.filter(d => d.status === 'missing').length || 0
  const cliOutdatedCount = statusData?.cli_tools.filter(d => d.status === 'outdated').length || 0
  const cliIssues = cliMissingCount + cliOutdatedCount
  
  // Count how many require sudo
  const sudoRequiredCount = statusData?.cli_tools.filter(
    d => (d.status === 'missing' || d.status === 'outdated') && d.requires_sudo
  ).length || 0

  return (
    <>
      {/* Sudo Password Modal */}
      <SudoPasswordModal
        isOpen={showPasswordModal}
        onClose={closePasswordModal}
        onSubmit={submitPassword}
        dependencyName={passwordDependency}
        attemptsRemaining={attemptsRemaining}
        maxAttempts={3}
        isValidating={isValidatingPassword}
        isInvalid={isPasswordInvalid}
      />
      
      <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">System Dependencies</h2>
        <p className="text-muted-foreground mt-1">
          {statusData?.platform_description || 'Check and install required dependencies'}
        </p>
      </div>

      {/* Status Summary */}
      <div className={`
        rounded-lg p-4 flex items-center justify-between
        ${statusData?.cli_tools_satisfied 
          ? 'bg-success/10 border border-success/30' 
          : 'bg-warning/10 border border-warning/30'
        }
      `}>
        <div className="flex items-center gap-3">
          {statusData?.cli_tools_satisfied ? (
            <>
              <CheckCircle2 className="w-6 h-6 text-success" />
              <div>
                <p className="font-medium text-success">CLI tools ready</p>
                <p className="text-sm text-muted-foreground">
                  {statusData?.cluster_available 
                    ? 'Cluster available - all components ready'
                    : 'Cluster components will be installed during deployment'
                  }
                </p>
              </div>
            </>
          ) : (
            <>
              <AlertTriangle className="w-6 h-6 text-warning" />
              <div>
                <p className="font-medium text-warning">
                  {cliIssues} CLI {cliIssues === 1 ? 'tool' : 'tools'} need attention
                </p>
                <p className="text-sm text-muted-foreground">
                  {cliMissingCount > 0 && `${cliMissingCount} missing`}
                  {cliMissingCount > 0 && cliOutdatedCount > 0 && ', '}
                  {cliOutdatedCount > 0 && `${cliOutdatedCount} outdated`}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            onClick={() => refetch()}
            disabled={installing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>

          {/* Install All / Cancel button */}
          {cliIssues > 0 && (
            installing ? (
              <button
                onClick={cancelInstallation}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Square className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <button
                onClick={installAllMissing}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Play className="w-4 h-4" />
                Install All
              </button>
            )
          )}
        </div>
      </div>

      {/* CLI Tools Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-lg font-medium">
          <Wrench className="w-5 h-5" />
          CLI Tools
          <span className="text-sm font-normal text-muted-foreground">
            (installed on your machine)
          </span>
        </div>
        
        {statusData?.cli_tools.map((dep) => (
          <DependencyCard
            key={dep.name}
            dep={dep}
            isInstalling={installing}
            installProgress={progress[dep.name]}
            onInstall={installOne}
          />
        ))}
      </div>

      {/* Cluster Components Section */}
      {statusData?.cluster_components && statusData.cluster_components.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-lg font-medium">
            <Server className="w-5 h-5" />
            Cluster Components
            <span className="text-sm font-normal text-muted-foreground">
              (installed in Kubernetes during deployment)
            </span>
          </div>
          
          {!statusData.cluster_available && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
              <p className="text-blue-600 dark:text-blue-400">
                <Clock className="w-4 h-4 inline mr-2" />
                No cluster detected. These components will be automatically installed during the deployment step.
              </p>
            </div>
          )}
          
          {statusData?.cluster_components.map((dep) => (
            <DependencyCard
              key={dep.name}
              dep={dep}
              isInstalling={installing}
              installProgress={progress[dep.name]}
              onInstall={installOne}
            />
          ))}
        </div>
      )}

      {/* Installation Log */}
      {installLog.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <TerminalIcon className="w-4 h-4" />
            Installation Log
          </h3>
          <div className="bg-black rounded-lg p-4 max-h-48 overflow-y-auto">
            {installLog.map((line, i) => (
              <div key={i} className="text-xs text-green-400 font-mono">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next step hint */}
      {statusData?.cli_tools_satisfied && (
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            ✓ All CLI tools are ready. Click <strong>Next</strong> to continue to profile selection.
            {!statusData.cluster_available && (
              <span className="block mt-1 text-blue-500">
                Cluster components (k3d, cert-manager, KServe) will be set up during deployment.
              </span>
            )}
          </p>
        </div>
      )}
      
      {/* Sudo required hint */}
      {!statusData?.cli_tools_satisfied && sudoRequiredCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
          <Lock className="w-5 h-5 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {sudoRequiredCount} {sudoRequiredCount === 1 ? 'dependency requires' : 'dependencies require'} administrator privileges.
            </span>
            {' '}You will be prompted for your password during installation.
          </p>
        </div>
      )}
    </div>
    </>
  )
}
