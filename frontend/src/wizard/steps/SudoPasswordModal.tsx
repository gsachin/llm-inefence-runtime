import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  Lock, 
  Eye, 
  EyeOff, 
  AlertTriangle, 
  X,
  Loader2,
  ShieldCheck
} from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

export interface SudoPasswordModalProps {
  /** Whether the modal is visible */
  isOpen: boolean
  /** Close the modal */
  onClose: () => void
  /** Submit password callback */
  onSubmit: (password: string) => void
  /** Name of the dependency requiring sudo */
  dependencyName?: string
  /** Number of attempts remaining */
  attemptsRemaining: number
  /** Maximum number of attempts */
  maxAttempts?: number
  /** Whether password is being validated */
  isValidating?: boolean
  /** Whether the last password was invalid */
  isInvalid?: boolean
}

// =============================================================================
// Modal Component
// =============================================================================

export function SudoPasswordModal({
  isOpen,
  onClose,
  onSubmit,
  dependencyName,
  attemptsRemaining,
  maxAttempts = 3,
  isValidating = false,
  isInvalid = false,
}: SudoPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to ensure modal is visible
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])
  
  // Clear password when modal closes or becomes invalid
  useEffect(() => {
    if (!isOpen) {
      setPassword('')
      setShowPassword(false)
    }
  }, [isOpen])
  
  // Clear password on invalid attempt
  useEffect(() => {
    if (isInvalid) {
      setPassword('')
      inputRef.current?.focus()
    }
  }, [isInvalid])
  
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (password.trim() && !isValidating) {
      onSubmit(password)
    }
  }, [password, isValidating, onSubmit])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])
  
  if (!isOpen) return null
  
  const usedAttempts = maxAttempts - attemptsRemaining
  const isLastAttempt = attemptsRemaining === 1
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Sudo Password Required</h3>
              {dependencyName && (
                <p className="text-sm text-muted-foreground">
                  To install <span className="font-medium text-foreground">{dependencyName}</span>
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Security notice */}
          <div className="flex items-start gap-3 p-3 rounded-md bg-blue-500/10 border border-blue-500/20 mb-4">
            <ShieldCheck className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              Your password is used only for this installation session and is never stored.
            </p>
          </div>
          
          {/* Error message for invalid password */}
          {isInvalid && (
            <div className="flex items-start gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/30 mb-4">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Incorrect password</p>
                <p className="text-muted-foreground">
                  {isLastAttempt 
                    ? 'This is your last attempt before installation is cancelled.'
                    : `${attemptsRemaining} ${attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining.`
                  }
                </p>
              </div>
            </div>
          )}
          
          {/* Password input */}
          <div className="space-y-2">
            <label htmlFor="sudo-password" className="block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="sudo-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isValidating}
                placeholder="Enter your password"
                className={`
                  w-full px-4 py-3 pr-12 rounded-md border bg-background
                  focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${isInvalid ? 'border-destructive focus:ring-destructive/50 focus:border-destructive' : 'border-input'}
                `}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Eye className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          
          {/* Attempts indicator */}
          {usedAttempts > 0 && (
            <div className="mt-3 flex items-center gap-2">
              {Array.from({ length: maxAttempts }).map((_, i) => (
                <div
                  key={i}
                  className={`
                    w-2 h-2 rounded-full transition-colors
                    ${i < usedAttempts ? 'bg-destructive' : 'bg-muted-foreground/30'}
                  `}
                />
              ))}
              <span className="text-xs text-muted-foreground ml-1">
                {attemptsRemaining} {attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining
              </span>
            </div>
          )}
          
          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isValidating}
              className="px-4 py-2 rounded-md border border-input hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isValidating}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors
                ${!password.trim() || isValidating
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }
              `}
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Submit
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default SudoPasswordModal
