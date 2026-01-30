import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { isEncryptionAvailable } from '../../state/wizardState'
import { 
  KeyRound, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Eye, 
  EyeOff,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react'

// =============================================================================
// Components
// =============================================================================

function HuggingFaceForm({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (token: string) => {
      // Validate token format
      if (!token.startsWith('hf_')) {
        throw new Error('Token must start with "hf_"')
      }
      return api.setupHuggingFace(token)
    },
    onSuccess: (data) => {
      if (data.success) {
        onSuccess()
      } else {
        setError(data.error || 'Failed to save token')
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save token')
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    mutation.mutate(token)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="hf-token" className="block text-sm font-medium mb-2">
          Hugging Face Token
        </label>
        <div className="relative">
          <input
            id="hf-token"
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="hf_..."
            className="w-full px-4 py-2 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary pr-10"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Get your token from{' '}
          <a
            href="https://huggingface.co/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            huggingface.co/settings/tokens
          </a>
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!token || mutation.isPending}
        className={`
          w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors
          ${token && !mutation.isPending
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
          }
        `}
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <KeyRound className="w-4 h-4" />
            Save to Keychain
          </>
        )}
      </button>
    </form>
  )
}

function CredentialCard({
  title,
  description,
  isConfigured,
  children,
}: {
  title: string
  description: string
  isConfigured: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {isConfigured ? (
          <span className="flex items-center gap-1 text-success text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Configured
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground text-sm">
            <XCircle className="w-4 h-4" />
            Not configured
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function SecurityBadge() {
  const [isSecure, setIsSecure] = useState<boolean | null>(null)

  useState(() => {
    isEncryptionAvailable().then(setIsSecure)
  })

  if (isSecure === null) return null

  return (
    <div className={`flex items-center gap-2 text-sm ${isSecure ? 'text-success' : 'text-warning'}`}>
      {isSecure ? (
        <>
          <ShieldCheck className="w-4 h-4" />
          Credentials will be stored securely in your OS keychain
        </>
      ) : (
        <>
          <ShieldAlert className="w-4 h-4" />
          Secure storage not available - credentials will be encrypted locally
        </>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function CredentialStep() {
  const queryClient = useQueryClient()

  // Fetch credential status
  const { data: status, isLoading } = useQuery({
    queryKey: ['credentials', 'status'],
    queryFn: () => api.getCredentialStatus(),
  })

  const handleHuggingFaceSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['credentials', 'status'] })
  }

  // Auto-advance if HuggingFace is already configured
  const hfConfigured = status?.huggingface_configured ?? false

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Checking credentials...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Credentials</h1>
        <p className="text-muted-foreground">
          Set up access tokens for model downloads and cloud services.
        </p>
      </div>

      <SecurityBadge />

      {/* Hugging Face Token */}
      <CredentialCard
        title="Hugging Face"
        description="Required for downloading models from Hugging Face Hub"
        isConfigured={hfConfigured}
      >
        {hfConfigured ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Token is securely stored
            </p>
            <button
              onClick={() => {
                api.deleteHuggingFace().then(() => {
                  queryClient.invalidateQueries({ queryKey: ['credentials', 'status'] })
                })
              }}
              className="text-sm text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <HuggingFaceForm onSuccess={handleHuggingFaceSuccess} />
        )}
      </CredentialCard>

      {/* AWS Credentials (optional) */}
      <CredentialCard
        title="AWS Credentials"
        description="Optional - only needed for AWS cloud deployments"
        isConfigured={status?.aws_configured ?? false}
      >
        <p className="text-sm text-muted-foreground">
          AWS credentials can be configured later if needed for cloud deployments.
        </p>
      </CredentialCard>

      {/* Skip hint if HF is configured */}
      {hfConfigured && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
          <p className="text-sm text-success">
            Credentials are ready! Click <strong>Next</strong> to select a model profile.
          </p>
        </div>
      )}
    </div>
  )
}
