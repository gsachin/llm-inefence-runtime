import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, CostBreakdown } from '../api/client'
import { getState, setState } from '../state/wizardState'
import { 
  Monitor, 
  KeyRound, 
  Layers, 
  Rocket, 
  LayoutDashboard,
  Flame,
  ChevronLeft,
  ChevronRight,
  X,
  Package
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

interface Step {
  id: string
  path: string
  label: string
  icon: React.ReactNode
}

const STEPS: Step[] = [
  { id: 'platform', path: '/step/platform', label: 'Platform', icon: <Monitor className="w-5 h-5" /> },
  { id: 'credentials', path: '/step/credentials', label: 'Credentials', icon: <KeyRound className="w-5 h-5" /> },
  { id: 'dependencies', path: '/step/dependencies', label: 'Dependencies', icon: <Package className="w-5 h-5" /> },
  { id: 'profile', path: '/step/profile', label: 'Profile', icon: <Layers className="w-5 h-5" /> },
  { id: 'deploy', path: '/step/deploy', label: 'Deploy', icon: <Rocket className="w-5 h-5" /> },
  { id: 'dashboard', path: '/step/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
]

// =============================================================================
// Components
// =============================================================================

function StepIndicator({ step, index, currentIndex }: { step: Step; index: number; currentIndex: number }) {
  const isActive = index === currentIndex
  const isCompleted = index < currentIndex

  return (
    <div className="flex items-center">
      <div
        className={`
          flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all
          ${isActive ? 'border-primary bg-primary text-primary-foreground' : ''}
          ${isCompleted ? 'border-success bg-success text-success-foreground' : ''}
          ${!isActive && !isCompleted ? 'border-muted-foreground/30 text-muted-foreground' : ''}
        `}
      >
        {step.icon}
      </div>
      <span
        className={`
          ml-2 text-sm font-medium hidden lg:block
          ${isActive ? 'text-foreground' : 'text-muted-foreground'}
        `}
      >
        {step.label}
      </span>
    </div>
  )
}

function StepConnector({ isCompleted }: { isCompleted: boolean }) {
  return (
    <div
      className={`
        flex-1 h-0.5 mx-2 transition-colors
        ${isCompleted ? 'bg-success' : 'bg-muted-foreground/30'}
      `}
    />
  )
}

function CostBadge({ cost }: { cost: CostBreakdown | undefined }) {
  if (!cost || cost.total_cost_per_hour === 0) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground text-sm">
        <Flame className="w-4 h-4" />
        <span>$0/hr</span>
      </div>
    )
  }

  const hourly = cost.total_cost_per_hour
  const color = hourly < 1 ? 'text-success' : hourly < 5 ? 'text-warning' : 'text-destructive'

  return (
    <div className={`flex items-center gap-1 ${color} text-sm font-medium`}>
      <Flame className="w-4 h-4 animate-pulse-slow" />
      <span>${hourly.toFixed(2)}/hr</span>
      <span className="text-muted-foreground text-xs">
        (~${cost.estimated_daily_cost.toFixed(0)}/day)
      </span>
    </div>
  )
}

function PlatformBadge({ platform }: { platform: string | undefined }) {
  if (!platform) return null

  const labels: Record<string, string> = {
    mac_m_series: '🍎 Apple Silicon',
    linux_workstation: '🐧 Linux',
    wsl2_windows: '🪟 WSL2',
  }

  return (
    <div className="text-sm text-muted-foreground">
      {labels[platform] || platform}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function WizardShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [currentIndex, setCurrentIndex] = useState(0)

  // Detect current step from URL
  useEffect(() => {
    const index = STEPS.findIndex((s) => location.pathname === s.path)
    if (index >= 0) {
      setCurrentIndex(index)
      setState('currentStep', index)
    }
  }, [location.pathname])

  // Check for in-progress deploy on mount
  useEffect(() => {
    async function checkResume() {
      const deployInProgress = await getState('deployInProgress')
      if (deployInProgress) {
        navigate('/step/deploy')
      }
    }
    checkResume()
  }, [navigate])

  // Fetch platform info
  const { data: platform } = useQuery({
    queryKey: ['platform'],
    queryFn: () => api.detectPlatform(),
    staleTime: Infinity,
  })

  // Fetch cost info (poll every 30s when on dashboard)
  const { data: cost } = useQuery({
    queryKey: ['cost'],
    queryFn: () => api.getCostBreakdown(),
    refetchInterval: location.pathname === '/step/dashboard' ? 30_000 : false,
  })

  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < STEPS.length - 1
  const isDeploying = location.pathname === '/step/deploy'

  const handleBack = () => {
    if (canGoBack && !isDeploying) {
      navigate(STEPS[currentIndex - 1].path)
    }
  }

  const handleNext = () => {
    if (canGoForward) {
      navigate(STEPS[currentIndex + 1].path)
    }
  }

  const handleCancel = () => {
    if (confirm('Are you sure you want to cancel? Any in-progress deployment will be stopped.')) {
      navigate('/step/platform')
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <header className="border-b border-border px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">MLOps Wizard</h1>
            <PlatformBadge platform={platform?.platform_name} />
          </div>
          <CostBadge cost={cost} />
        </div>
      </header>

      {/* Step Indicator */}
      <nav className="border-b border-border px-6 py-4">
        <div className="flex items-center max-w-3xl mx-auto">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <StepIndicator step={step} index={index} currentIndex={currentIndex} />
              {index < STEPS.length - 1 && <StepConnector isCompleted={index < currentIndex} />}
            </div>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-6">
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation */}
      <footer className="border-t border-border px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              disabled={!canGoBack || isDeploying}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-md border transition-colors
                ${canGoBack && !isDeploying
                  ? 'border-border hover:bg-muted cursor-pointer'
                  : 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
                }
              `}
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={!canGoForward}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-md transition-colors
                ${canGoForward
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
                }
              `}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
