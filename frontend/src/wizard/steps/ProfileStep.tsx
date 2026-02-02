import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, PlatformProfile, FeasibilityResponse, OllamaStatusResponse, SupportedModel } from '../../api/client'
import { setState } from '../../state/wizardState'
import { 
  Cpu, 
  Zap, 
  MemoryStick,
  CheckCircle2, 
  AlertTriangle,
  XCircle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Lock,
  Server,
  Clock,
  Download,
  HardDrive,
  Ban
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

interface ProfileWithFeasibility extends PlatformProfile {
  feasibility?: FeasibilityResponse
  selectedModel?: string
  runtime?: 'vllm' | 'ollama'
}

// =============================================================================
// Ollama Status Component
// =============================================================================

function OllamaStatusBanner({ status }: { status: OllamaStatusResponse | undefined; isLoading: boolean }) {
  if (!status) {
    return null
  }

  if (!status.running) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <XCircle className="w-4 h-4" />
          <span><strong>Ollama is not running.</strong> Start it with: <code className="bg-muted px-1 rounded">sudo systemctl start ollama</code></span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-success/10 border border-success/30 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-success text-sm">
          <Server className="w-4 h-4" />
          <span><strong>Ollama</strong> v{status.version} running</span>
          {status.gpu_available && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-success/20 rounded-full text-xs">
              <Zap className="w-3 h-3" />
              GPU Active
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {status.models.length} model{status.models.length !== 1 ? 's' : ''} loaded
        </span>
      </div>
    </div>
  )
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDeployTime(minutes: number): string {
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `~${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `~${hours}h ${mins}m` : `~${hours}h`
}

function getSelectedModelInfo(profile: ProfileWithFeasibility): SupportedModel | undefined {
  const selectedId = profile.selectedModel || profile.model
  return profile.supported_models?.find(m => m.id === selectedId)
}

// =============================================================================
// Components
// =============================================================================

function FeasibilityBadge({ status }: { status: FeasibilityResponse['status'] | undefined }) {
  if (!status) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking...
      </span>
    )
  }

  const badges = {
    supported: {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: 'Supported',
      className: 'text-success bg-success/10',
    },
    warning: {
      icon: <AlertTriangle className="w-4 h-4" />,
      label: 'Limited',
      className: 'text-warning bg-warning/10',
    },
    unsupported: {
      icon: <XCircle className="w-4 h-4" />,
      label: 'Unsupported',
      className: 'text-destructive bg-destructive/10',
    },
  }

  const badge = badges[status]

  return (
    <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${badge.className}`}>
      {badge.icon}
      {badge.label}
    </span>
  )
}

function ProfileCard({
  profile,
  isSelected,
  isRecommended,
  onSelect,
  onModelChange,
}: {
  profile: ProfileWithFeasibility
  isSelected: boolean
  isRecommended: boolean
  onSelect: () => void
  onModelChange: (modelId: string) => void
}) {
  const isDisabled = profile.feasibility?.status === 'unsupported'
  const hasModels = profile.supported_models && profile.supported_models.length > 0
  const selectedModel = profile.selectedModel || profile.model
  const selectedModelInfo = getSelectedModelInfo(profile)

  return (
    <button
      onClick={onSelect}
      disabled={isDisabled}
      className={`
        w-full text-left p-4 rounded-lg border-2 transition-all
        ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{profile.name}</h3>
            {isRecommended && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs">
                <Sparkles className="w-3 h-3" />
                Recommended
              </span>
            )}
            {profile.gpu_count > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-success/10 text-success rounded-full text-xs">
                <Zap className="w-3 h-3" />
                GPU
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>
        </div>
        <FeasibilityBadge status={profile.feasibility?.status} />
      </div>

      {/* Model Selection with Size and Deploy Time */}
      {hasModels ? (
        <div className="mb-3" onClick={(e) => e.stopPropagation()}>
          <label className="text-xs text-muted-foreground mb-1 block">Select Model:</label>
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={isDisabled}
              className="w-full px-3 py-2 pr-8 bg-muted/50 border border-border rounded text-sm appearance-none cursor-pointer disabled:cursor-not-allowed"
            >
              {profile.supported_models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.size_gb}GB) {m.gated ? '🔒' : ''} {m.recommended ? '⭐' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
          
          {/* Deployment Time Estimate */}
          {selectedModelInfo && (
            <div className="flex flex-wrap gap-3 mt-2 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Download className="w-3 h-3" />
                {selectedModelInfo.size_gb}GB download
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <HardDrive className="w-3 h-3" />
                {selectedModelInfo.memory_needed_gb || (selectedModelInfo.size_gb * 2.5).toFixed(0)}GB RAM needed
              </span>
              <span className="flex items-center gap-1 text-success">
                <Clock className="w-3 h-3" />
                {formatDeployTime(selectedModelInfo.download_minutes || Math.ceil(selectedModelInfo.size_gb * 2))} to deploy
              </span>
              {selectedModelInfo.gpu_verified && (
                <span className="flex items-center gap-1 text-success">
                  <Zap className="w-3 h-3" />
                  GPU Verified
                </span>
              )}
            </div>
          )}
          
          {profile.supported_models.find(m => m.id === selectedModel)?.gated && (
            <p className="text-xs text-warning mt-1 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Requires HuggingFace token
            </p>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground mb-3">
          <code className="bg-muted px-2 py-0.5 rounded">{profile.model}</code>
        </div>
      )}

      {/* Resource Requirements */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Cpu className="w-3 h-3" />
          {profile.resources.cpu_request} CPU
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <MemoryStick className="w-3 h-3" />
          {profile.resources.mem_request}
        </span>
        {profile.gpu_count > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Zap className="w-3 h-3" />
            {profile.gpu_count} GPU
          </span>
        )}
      </div>

      {/* Warnings */}
      {profile.feasibility?.status === 'warning' && profile.feasibility.actions.length > 0 && (
        <div className="mt-3 text-xs text-warning">
          ⚠️ {profile.feasibility.actions[0].reason}
        </div>
      )}
    </button>
  )
}

// =============================================================================
// Unsupported Profiles Section (Collapsible)
// =============================================================================

function UnsupportedProfilesSection({ profiles }: { profiles: PlatformProfile[] }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (profiles.length === 0) return null

  return (
    <div className="border border-destructive/20 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-destructive/5 hover:bg-destructive/10 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Ban className="w-4 h-4 text-destructive" />
          <span>
            <strong>{profiles.length}</strong> profile{profiles.length !== 1 ? 's' : ''} not compatible with your hardware
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      
      {isExpanded && (
        <div className="p-3 space-y-2 bg-muted/30">
          {profiles.map((profile) => (
            <div 
              key={profile.name}
              className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50 opacity-60"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{profile.name}</span>
                  {profile.gpu_count > 0 && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-xs">
                      <Zap className="w-3 h-3" />
                      GPU
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{profile.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
                  {profile.incompatibility_reason || 'Not compatible'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function ProfileStep() {
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [profilesWithFeasibility, setProfilesWithFeasibility] = useState<ProfileWithFeasibility[]>([])

  // Fetch platform-aware profiles (includes supported models)
  const { data: platformData, isLoading: profilesLoading } = useQuery({
    queryKey: ['platform-profiles'],
    queryFn: () => api.getPlatformProfiles(),
  })

  // Fetch Ollama status for DGX Spark
  const { data: ollamaStatus, isLoading: ollamaLoading } = useQuery({
    queryKey: ['ollama-status'],
    queryFn: () => api.getOllamaStatus(),
    refetchInterval: 5000, // Poll every 5 seconds
    retry: false, // Don't retry if Ollama is not running
  })

  // Fetch hardware for display
  const { data: hardware } = useQuery({
    queryKey: ['hardware'],
    queryFn: () => api.probeHardware(),
    staleTime: Infinity,
  })

  // Initialize profiles with feasibility checks
  useEffect(() => {
    if (!platformData?.profiles) return

    // Initialize with recommended profiles marked
    const initialized = platformData.profiles.map((p) => ({
      ...p,
      selectedModel: p.supported_models?.find(m => m.recommended)?.id || p.model,
      feasibility: platformData.recommended_profiles.includes(p.name)
        ? { status: 'supported' as const, actions: [], recommended_profiles: platformData.recommended_profiles, environment_config: {}, hardware: {} }
        : undefined,
    }))
    
    setProfilesWithFeasibility(initialized)

    // Fetch detailed feasibility for each profile
    platformData.profiles.forEach(async (profile) => {
      try {
        const feasibility = await api.checkFeasibility(profile.name)
        setProfilesWithFeasibility((prev) =>
          prev.map((p) => (p.name === profile.name ? { ...p, feasibility } : p))
        )
      } catch (error) {
        console.error(`Failed to check feasibility for ${profile.name}:`, error)
      }
    })
  }, [platformData])

  // Determine recommended profiles
  const recommendedProfiles = platformData?.recommended_profiles || []

  // Auto-select first recommended profile
  useEffect(() => {
    if (!selectedProfile && recommendedProfiles.length > 0) {
      setSelectedProfile(recommendedProfiles[0])
    }
  }, [recommendedProfiles, selectedProfile])

  // Handle model change for a profile
  const handleModelChange = (profileName: string, modelId: string) => {
    setProfilesWithFeasibility((prev) =>
      prev.map((p) => (p.name === profileName ? { ...p, selectedModel: modelId } : p))
    )
  }

  // Save selection to state
  useEffect(() => {
    if (selectedProfile) {
      const profile = profilesWithFeasibility.find(p => p.name === selectedProfile)
      setState('selectedProfile', selectedProfile)
      if (profile?.selectedModel) {
        setState('selectedModel', profile.selectedModel)
      }
      // Store runtime type for deploy step
      // Check profile's platform field or if it's a known Ollama profile
      const isOllamaProfile = (
        profile?.platform === 'linux_dgx_spark' ||
        (profile as any)?.runtime === 'ollama' ||
        selectedProfile === 'dgx_spark'  // Fallback for compatibility
      )
      setState('runtime', isOllamaProfile ? 'ollama' : 'vllm')
    }
  }, [selectedProfile, profilesWithFeasibility])

  if (profilesLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Loading profiles...</p>
      </div>
    )
  }

  // Get unsupported profiles from API response
  const unsupportedProfiles = platformData?.unsupported_profiles || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Select Model Profile</h1>
        <p className="text-muted-foreground">
          Choose a model configuration based on your hardware capabilities.
        </p>
      </div>

      {/* Ollama Status Banner (for DGX Spark) */}
      {platformData?.platform_name === 'linux_dgx_spark' && (
        <OllamaStatusBanner status={ollamaStatus} isLoading={ollamaLoading} />
      )}

      {/* Hardware summary */}
      {hardware && (
        <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Your hardware:</span>
          <span className="flex items-center gap-1">
            <MemoryStick className="w-4 h-4" />
            {hardware.ram_gb.toFixed(0)} GB RAM
          </span>
          {hardware.gpu_type && (
            <span className="flex items-center gap-1">
              <Zap className="w-4 h-4" />
              {hardware.gpu_type}
              {hardware.vram_gb > 0 && ` (${hardware.vram_gb} GB)`}
            </span>
          )}
        </div>
      )}

      {/* Supported Profile Grid */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-success" />
          Compatible Profiles ({profilesWithFeasibility.length})
        </h2>
        <div className="grid gap-4">
          {profilesWithFeasibility.map((profile) => (
            <ProfileCard
              key={profile.name}
              profile={profile}
              isSelected={selectedProfile === profile.name}
              isRecommended={recommendedProfiles.includes(profile.name)}
              onSelect={() => setSelectedProfile(profile.name)}
              onModelChange={(modelId) => handleModelChange(profile.name, modelId)}
            />
          ))}
        </div>
      </div>

      {/* Unsupported Profiles Section (Collapsible) */}
      <UnsupportedProfilesSection profiles={unsupportedProfiles} />

      {/* Platform info */}
      {platformData && (
        <div className="text-xs text-muted-foreground text-center">
          Platform: <strong>{platformData.platform_name}</strong> • 
          {profilesWithFeasibility.length} compatible • {unsupportedProfiles.length} incompatible
        </div>
      )}

      {/* Selection status with deploy time */}
      {selectedProfile && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-success">
              Selected: <strong>{selectedProfile}</strong>
            </p>
            {(() => {
              const profile = profilesWithFeasibility.find(p => p.name === selectedProfile)
              const modelInfo = profile ? getSelectedModelInfo(profile) : undefined
              if (modelInfo?.download_minutes) {
                return (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Clock className="w-3 h-3" />
                    Est. deploy: {formatDeployTime(modelInfo.download_minutes)}
                  </span>
                )
              }
              return null
            })()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Click <strong>Next</strong> to proceed with deployment.
          </p>
        </div>
      )}
    </div>
  )
}
