import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ResourceInfo } from '../../api/client'
import { 
  LayoutDashboard, 
  Flame, 
  Trash2, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  DollarSign,
  Clock,
  Server,
  Download,
  ChevronDown,
  ChevronUp,
  Key,
  FileJson,
  Zap,
  Copy,
  Check
} from 'lucide-react'

// =============================================================================
// Components
// =============================================================================

function CostCard({ 
  hourly, 
  daily, 
  monthly 
}: { 
  hourly: number
  daily: number
  monthly: number 
}) {
  const color = hourly < 1 ? 'text-success' : hourly < 5 ? 'text-warning' : 'text-destructive'

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <Flame className={`w-5 h-5 ${color}`} />
        <h3 className="font-semibold">Cost Estimate</h3>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Hourly</p>
          <p className={`text-2xl font-bold ${color}`}>${hourly.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Daily</p>
          <p className="text-2xl font-bold">${daily.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Monthly</p>
          <p className="text-2xl font-bold">${monthly.toFixed(0)}</p>
        </div>
      </div>
    </div>
  )
}

function ResourceRow({ 
  resource, 
  onDestroy 
}: { 
  resource: ResourceInfo
  onDestroy: () => void 
}) {
  const [isDestroying, setIsDestroying] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Determine display state based on actual readiness
  const getDisplayState = () => {
    // If helm says active but kserve not ready, show loading state
    if (resource.state === 'active' && !resource.kserve_ready) {
      return 'loading'
    }
    // If model failed to load
    if (resource.model_state === 'failed') {
      return 'model_failed'
    }
    return resource.state
  }

  const displayState = getDisplayState()

  const stateColors: Record<string, string> = {
    active: 'text-success',
    pending: 'text-warning',
    provisioning: 'text-warning',
    loading: 'text-amber-500',
    model_failed: 'text-destructive',
    failed: 'text-destructive',
    destroying: 'text-muted-foreground',
  }

  const stateIcons: Record<string, React.ReactNode> = {
    active: <CheckCircle2 className="w-4 h-4" />,
    pending: <Clock className="w-4 h-4" />,
    provisioning: <Loader2 className="w-4 h-4 animate-spin" />,
    loading: <Loader2 className="w-4 h-4 animate-spin" />,
    model_failed: <XCircle className="w-4 h-4" />,
    failed: <XCircle className="w-4 h-4" />,
    destroying: <Loader2 className="w-4 h-4 animate-spin" />,
  }

  const stateLabels: Record<string, string> = {
    active: 'Ready',
    pending: 'Pending',
    provisioning: 'Deploying...',
    loading: 'Loading Model...',
    model_failed: 'Model Failed',
    failed: 'Failed',
    destroying: 'Destroying...',
  }

  const handleDestroy = async () => {
    setIsDestroying(true)
    await onDestroy()
    setIsDestroying(false)
  }

  const feasibility = resource.feasibility
  const apiInfo = resource.api_info
  const apiSchema = resource.api_schema
  const hasDetails = feasibility || apiInfo || apiSchema

  return (
    <>
      <tr className="border-b border-border hover:bg-muted/50">
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {hasDetails && (
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 hover:bg-muted rounded"
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
            <Server className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-sm">{resource.resource_id}</span>
            {feasibility?.recommended && (
              <span className="px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">⭐ Recommended</span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-sm text-muted-foreground">
          {resource.resource_type === 'OllamaModelResource' ? 'ollama_model' : resource.resource_type}
        </td>
        <td className="py-3 px-4">
          <div className="flex flex-col">
            <span className={`flex items-center gap-1 text-sm ${stateColors[displayState] || 'text-muted-foreground'}`}>
              {stateIcons[displayState]}
              {stateLabels[displayState] || displayState}
            </span>
            {displayState === 'loading' && resource.model_state && (
              <span className="text-xs text-muted-foreground mt-0.5">
                Model: {resource.model_state}
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-sm">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {resource.cost_per_hour.toFixed(2)}/hr
          </span>
        </td>
        <td className="py-3 px-4">
          <button
            onClick={handleDestroy}
            disabled={isDestroying || resource.state === 'destroying'}
            className={`
              flex items-center gap-1 px-2 py-1 text-sm rounded
              ${isDestroying || resource.state === 'destroying'
                ? 'text-muted-foreground cursor-not-allowed'
                : 'text-destructive hover:bg-destructive/10'
              }
            `}
          >
            {isDestroying ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Trash2 className="w-3 h-3" />
            )}
            Destroy
          </button>
        </td>
      </tr>
      
      {/* Expanded Details Row */}
      {isExpanded && hasDetails && (
        <tr className="bg-muted/30">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Feasibility Study Card */}
              {feasibility && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h4 className="font-semibold flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-primary" />
                    Feasibility Study
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <span className={`font-medium ${feasibility.feasibility === 'VERIFIED' ? 'text-success' : 'text-warning'}`}>
                        {feasibility.feasibility === 'VERIFIED' ? '✅ VERIFIED' : feasibility.feasibility}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Size:</span>
                      <span>{feasibility.size_gb.toFixed(1)} GB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Memory Needed:</span>
                      <span>{feasibility.memory_needed_gb} GB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Context Length:</span>
                      <span>{feasibility.context_length.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">License:</span>
                      <span>{feasibility.license}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GPU Verified:</span>
                      <span>{feasibility.gpu_verified ? '✅ Yes' : '❌ No'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gated:</span>
                      <span>{feasibility.gated ? '🔒 Yes' : '🔓 No (Free)'}</span>
                    </div>
                    {feasibility.note && (
                      <div className="pt-2 border-t border-border mt-2">
                        <p className="text-xs text-muted-foreground">{feasibility.note}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* API Endpoints Card */}
              {apiInfo && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h4 className="font-semibold flex items-center gap-2 mb-3">
                    <Key className="w-4 h-4 text-primary" />
                    API Endpoints
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Base URL:</span>
                      <div className="flex items-center gap-1">
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{apiInfo.base_url}</code>
                        <button 
                          onClick={() => copyToClipboard(apiInfo.base_url, 'base')}
                          className="p-1 hover:bg-muted rounded"
                        >
                          {copiedField === 'base' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="pt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20">Generate:</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded flex-1 truncate">/api/generate</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20">Chat:</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded flex-1 truncate">/api/chat</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20">Embeddings:</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded flex-1 truncate">/api/embeddings</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-20">Models:</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded flex-1 truncate">/api/tags</code>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border mt-2 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">OpenAI Compatible:</span>
                        <span>{apiInfo.openai_compatible ? '✅ Yes' : '❌ No'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">API Key Required:</span>
                        <span>{apiInfo.api_key_required ? '🔐 Yes' : '🔓 No'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* JSON Schema Card */}
              {apiSchema && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <h4 className="font-semibold flex items-center gap-2 mb-3">
                    <FileJson className="w-4 h-4 text-primary" />
                    API Schema & Examples
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Example cURL:</span>
                        <button 
                          onClick={() => copyToClipboard(apiSchema.example_curl, 'curl')}
                          className="p-1 hover:bg-muted rounded"
                        >
                          {copiedField === 'curl' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-24">
                        {apiSchema.example_curl}
                      </pre>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Example Python:</span>
                        <button 
                          onClick={() => copyToClipboard(apiSchema.example_python, 'python')}
                          className="p-1 hover:bg-muted rounded"
                        >
                          {copiedField === 'python' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-24">
                        {apiSchema.example_python}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
              
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function KillSwitch({ onDestroy }: { onDestroy: () => void }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDestroying, setIsDestroying] = useState(false)

  const handleDestroy = async () => {
    setIsDestroying(true)
    await onDestroy()
    setIsDestroying(false)
    setShowConfirm(false)
  }

  if (showConfirm) {
    return (
      <div className="bg-destructive/10 border-2 border-destructive rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-destructive mb-2">
          Destroy All Resources?
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          This will permanently delete all deployed services and cannot be undone.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setShowConfirm(false)}
            className="px-4 py-2 border border-border rounded-md hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleDestroy}
            disabled={isDestroying}
            className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
          >
            {isDestroying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Destroying...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Yes, Destroy All
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="flex items-center gap-2 px-6 py-3 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 text-lg font-semibold"
    >
      <AlertTriangle className="w-5 h-5" />
      Destroy Everything
    </button>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function DashboardStep() {
  const queryClient = useQueryClient()
  const [syncStatus, setSyncStatus] = useState<string | null>(null)

  // Sync resources mutation - discovers existing Helm releases
  const syncMutation = useMutation({
    mutationFn: () => api.syncResources('llm'),
    onSuccess: (data) => {
      if (data.registered > 0) {
        setSyncStatus(`Discovered ${data.registered} new resource(s)`)
      } else if (data.discovered > 0) {
        setSyncStatus(`${data.discovered} resource(s) already tracked`)
      } else {
        setSyncStatus('No resources found')
      }
      queryClient.invalidateQueries({ queryKey: ['resources'] })
      queryClient.invalidateQueries({ queryKey: ['cost'] })
      // Clear status after 3 seconds
      setTimeout(() => setSyncStatus(null), 3000)
    },
  })

  // Auto-sync on mount to discover existing resources
  useEffect(() => {
    syncMutation.mutate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch resources
  const { data: resources, isLoading: resourcesLoading, refetch } = useQuery({
    queryKey: ['resources'],
    queryFn: () => api.listResources(),
    refetchInterval: 10_000, // Poll every 10s
  })

  // Fetch cost breakdown
  const { data: cost } = useQuery({
    queryKey: ['cost'],
    queryFn: () => api.getCostBreakdown(),
    refetchInterval: 30_000, // Poll every 30s
  })

  // Destroy single resource
  const destroyMutation = useMutation({
    mutationFn: (resourceId: string) => api.destroyResource(resourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] })
      queryClient.invalidateQueries({ queryKey: ['cost'] })
    },
  })

  // Destroy all resources
  const destroyAllMutation = useMutation({
    mutationFn: () => api.destroyAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] })
      queryClient.invalidateQueries({ queryKey: ['cost'] })
    },
  })

  const hasResources = resources?.resources && resources.resources.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6" />
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Manage your deployed inference services.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-md hover:bg-muted"
            title="Discover existing deployments"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Sync
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-md hover:bg-muted"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncStatus && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          {syncStatus}
        </div>
      )}

      {/* Cost Card */}
      {cost && (
        <CostCard
          hourly={cost.total_cost_per_hour}
          daily={cost.estimated_daily_cost}
          monthly={cost.estimated_monthly_cost}
        />
      )}

      {/* Resources Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="font-semibold">Active Resources</h3>
        </div>

        {resourcesLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : !hasResources ? (
          <div className="text-center py-12 text-muted-foreground">
            <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No active resources</p>
            <p className="text-sm mt-1">Deploy a model to get started</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Resource</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Type</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">State</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Cost</th>
                <th className="text-left py-2 px-4 text-sm font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {resources?.resources.map((resource) => (
                <ResourceRow
                  key={resource.resource_id}
                  resource={resource}
                  onDestroy={() => destroyMutation.mutate(resource.resource_id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Kill Switch */}
      {hasResources && (
        <div className="flex justify-center pt-4">
          <KillSwitch onDestroy={() => destroyAllMutation.mutateAsync()} />
        </div>
      )}

      {/* Savings message after destroy */}
      {destroyAllMutation.isSuccess && destroyAllMutation.data && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
          <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
          <p className="text-success">
            Saved <strong>${destroyAllMutation.data.savings_per_hour.toFixed(2)}/hr</strong> by destroying{' '}
            {destroyAllMutation.data.destroyed.length} resources
          </p>
        </div>
      )}
    </div>
  )
}
