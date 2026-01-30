import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ProfileInfo, FeasibilityResponse } from '../../api/client'
import { setState } from '../../state/wizardState'
import { 
  Cpu, 
  Zap, 
  MemoryStick,
  CheckCircle2, 
  AlertTriangle,
  XCircle,
  Loader2,
  Sparkles
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

interface ProfileWithFeasibility extends ProfileInfo {
  feasibility?: FeasibilityResponse
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
}: {
  profile: ProfileWithFeasibility
  isSelected: boolean
  isRecommended: boolean
  onSelect: () => void
}) {
  const isDisabled = profile.feasibility?.status === 'unsupported'

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
          </div>
          <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>
        </div>
        <FeasibilityBadge status={profile.feasibility?.status} />
      </div>

      {/* Model Info */}
      <div className="text-sm text-muted-foreground mb-3">
        <code className="bg-muted px-2 py-0.5 rounded">{profile.model}</code>
      </div>

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
// Main Component
// =============================================================================

export function ProfileStep() {
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [profilesWithFeasibility, setProfilesWithFeasibility] = useState<ProfileWithFeasibility[]>([])

  // Fetch profiles
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.listProfiles(),
  })

  // Fetch hardware for recommendations
  const { data: hardware } = useQuery({
    queryKey: ['hardware'],
    queryFn: () => api.probeHardware(),
    staleTime: Infinity,
  })

  // Check feasibility for each profile
  useEffect(() => {
    if (!profiles || !Array.isArray(profiles)) return

    setProfilesWithFeasibility(profiles.map((p) => ({ ...p })))

    // Fetch feasibility for each profile
    profiles.forEach(async (profile) => {
      try {
        const feasibility = await api.checkFeasibility(profile.name)
        setProfilesWithFeasibility((prev) =>
          prev.map((p) => (p.name === profile.name ? { ...p, feasibility } : p))
        )
      } catch (error) {
        console.error(`Failed to check feasibility for ${profile.name}:`, error)
      }
    })
  }, [profiles])

  // Determine recommended profiles
  const recommendedProfiles = profilesWithFeasibility
    .filter((p) => p.feasibility?.status === 'supported')
    .filter((p) => p.feasibility?.recommended_profiles?.includes(p.name))
    .map((p) => p.name)

  // Auto-select first recommended profile
  useEffect(() => {
    if (!selectedProfile && recommendedProfiles.length > 0) {
      setSelectedProfile(recommendedProfiles[0])
    }
  }, [recommendedProfiles, selectedProfile])

  // Save selection to state
  useEffect(() => {
    if (selectedProfile) {
      setState('selectedProfile', selectedProfile)
    }
  }, [selectedProfile])

  if (profilesLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Loading profiles...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Select Model Profile</h1>
        <p className="text-muted-foreground">
          Choose a model configuration based on your hardware capabilities.
        </p>
      </div>

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

      {/* Profile Grid */}
      <div className="grid gap-4">
        {profilesWithFeasibility.map((profile) => (
          <ProfileCard
            key={profile.name}
            profile={profile}
            isSelected={selectedProfile === profile.name}
            isRecommended={recommendedProfiles.includes(profile.name)}
            onSelect={() => setSelectedProfile(profile.name)}
          />
        ))}
      </div>

      {/* Selection status */}
      {selectedProfile && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
          <p className="text-sm text-success">
            Selected: <strong>{selectedProfile}</strong>. Click <strong>Next</strong> to deploy.
          </p>
        </div>
      )}
    </div>
  )
}
