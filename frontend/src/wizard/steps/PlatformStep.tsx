import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, HardwareProbe, PlatformInfo } from '../../api/client'
import { 
  Cpu, 
  HardDrive, 
  MemoryStick, 
  Monitor, 
  Zap,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'

// =============================================================================
// Components
// =============================================================================

function HardwareCard({ hardware, platform }: { hardware: HardwareProbe; platform: PlatformInfo }) {
  const platformLabels: Record<string, { label: string; icon: string }> = {
    mac_m_series: { label: 'Apple Silicon Mac', icon: '🍎' },
    linux_workstation: { label: 'Linux Workstation', icon: '🐧' },
    linux_dgx_spark: { label: 'NVIDIA DGX Spark', icon: '🚀' },
    wsl2_windows: { label: 'Windows Subsystem for Linux', icon: '🪟' },
  }

  const info = platformLabels[platform.platform_name] || { label: platform.platform_name, icon: '💻' }

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      {/* Platform Header */}
      <div className="flex items-center gap-4">
        <div className="text-4xl">{info.icon}</div>
        <div>
          <h2 className="text-2xl font-bold">{info.label}</h2>
          <p className="text-muted-foreground">
            {(hardware.extra as Record<string, string>)?.chip_name || `${hardware.arch} architecture`}
          </p>
        </div>
      </div>

      {/* Hardware Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* RAM */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <MemoryStick className="w-4 h-4" />
            <span className="text-sm">Memory</span>
          </div>
          <p className="text-xl font-semibold">{hardware.ram_gb.toFixed(0)} GB</p>
        </div>

        {/* Disk */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <HardDrive className="w-4 h-4" />
            <span className="text-sm">Free Disk</span>
          </div>
          <p className="text-xl font-semibold">{hardware.disk_free_gb.toFixed(0)} GB</p>
        </div>

        {/* GPU */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Zap className="w-4 h-4" />
            <span className="text-sm">GPU</span>
          </div>
          <p className="text-xl font-semibold">
            {hardware.gpu_type || 'None'}
          </p>
          {hardware.vram_gb > 0 && (
            <p className="text-sm text-muted-foreground">{hardware.vram_gb} GB VRAM</p>
          )}
        </div>

        {/* Architecture */}
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Cpu className="w-4 h-4" />
            <span className="text-sm">Architecture</span>
          </div>
          <p className="text-xl font-semibold">{hardware.arch}</p>
        </div>
      </div>

      {/* Capability Badges */}
      <div className="flex flex-wrap gap-2">
        {hardware.metal_support && (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-success/10 text-success rounded-full text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Metal Support
          </span>
        )}
        {hardware.cuda_available && (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-success/10 text-success rounded-full text-sm">
            <CheckCircle2 className="w-4 h-4" />
            CUDA Available
          </span>
        )}
        {!hardware.metal_support && !hardware.cuda_available && (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-warning/10 text-warning rounded-full text-sm">
            <Monitor className="w-4 h-4" />
            CPU Only
          </span>
        )}
      </div>
    </div>
  )
}

function UnsupportedPlatform({ platform }: { platform: PlatformInfo }) {
  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center">
      <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-destructive mb-2">
        Unsupported Platform
      </h2>
      <p className="text-muted-foreground">
        Your system ({platform.system} {platform.machine}) is not currently supported.
      </p>
      <p className="text-sm text-muted-foreground mt-2">
        Supported platforms: macOS (Apple Silicon), Linux (x86_64 with NVIDIA GPU), Windows (WSL2)
      </p>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function PlatformStep() {
  const navigate = useNavigate()
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null)

  // Fetch platform info
  const { data: platform, isLoading: platformLoading, error: platformError } = useQuery({
    queryKey: ['platform'],
    queryFn: () => api.detectPlatform(),
    staleTime: Infinity,
  })

  // Fetch hardware info
  const { data: hardware, isLoading: hardwareLoading, error: hardwareError } = useQuery({
    queryKey: ['hardware'],
    queryFn: () => api.probeHardware(),
    staleTime: Infinity,
    enabled: !!platform?.is_supported,
  })

  const isLoading = platformLoading || hardwareLoading
  const error = platformError || hardwareError

  // Auto-advance after 4 seconds if platform is supported
  useEffect(() => {
    if (platform?.is_supported && hardware && !isLoading) {
      setAutoAdvanceCountdown(4)
    }
  }, [platform, hardware, isLoading])

  useEffect(() => {
    if (autoAdvanceCountdown === null) return
    if (autoAdvanceCountdown <= 0) {
      navigate('/step/credentials')
      return
    }

    const timer = setTimeout(() => {
      setAutoAdvanceCountdown((prev) => (prev !== null ? prev - 1 : null))
    }, 1000)

    return () => clearTimeout(timer)
  }, [autoAdvanceCountdown, navigate])

  const cancelAutoAdvance = () => {
    setAutoAdvanceCountdown(null)
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Detecting your hardware...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 text-center">
        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-destructive mb-2">
          Detection Failed
        </h2>
        <p className="text-muted-foreground">
          Could not detect your hardware. Make sure the backend is running.
        </p>
        <pre className="mt-4 text-sm text-left bg-muted p-3 rounded overflow-auto">
          {error instanceof Error ? error.message : 'Unknown error'}
        </pre>
      </div>
    )
  }

  // Unsupported platform
  if (platform && !platform.is_supported) {
    return <UnsupportedPlatform platform={platform} />
  }

  // Supported platform with hardware info
  if (platform && hardware) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Platform Detection</h1>
          <p className="text-muted-foreground">
            We&apos;ve detected your hardware. Review the details below.
          </p>
        </div>

        <HardwareCard hardware={hardware} platform={platform} />

        {/* Auto-advance notification */}
        {autoAdvanceCountdown !== null && (
          <div className="bg-muted/50 border border-border rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Continuing to next step in {autoAdvanceCountdown} seconds...
            </p>
            <button
              onClick={cancelAutoAdvance}
              className="text-sm text-primary hover:underline"
            >
              Stay on this page
            </button>
          </div>
        )}
      </div>
    )
  }

  return null
}
