import axios, { AxiosInstance, AxiosError } from 'axios'

// =============================================================================
// Types
// =============================================================================

export interface PlatformInfo {
  platform_name: string
  system: string
  machine: string
  is_supported: boolean
}

export interface HardwareProbe {
  arch: string
  platform: string
  ram_gb: number
  disk_free_gb: number
  gpu_type: string | null
  gpu_count: number
  vram_gb: number
  cuda_available: boolean
  metal_support: boolean
  extra: Record<string, unknown>
}

export interface CredentialStatus {
  aws_configured: boolean
  huggingface_configured: boolean
}

export interface ProfileInfo {
  name: string
  description: string
  model: string
  image: string
  gpu_count: number
  resources: {
    cpu_request: string
    cpu_limit: string
    mem_request: string
    mem_limit: string
  }
}

export interface SupportedModel {
  id: string
  name: string
  size_gb: number
  context: number
  gated: boolean
  recommended: boolean
  quantization?: string
  license?: string
  gpu_verified?: boolean
  note?: string
  // Deployment time estimates
  memory_needed_gb?: number
  download_minutes?: number
}

// Ollama types
export interface OllamaModelInfo {
  name: string
  size: number
  digest: string
  modified_at: string
  details?: Record<string, unknown>
}

export interface OllamaStatusResponse {
  running: boolean
  version?: string
  gpu_available: boolean
  gpu_info?: string
  models: OllamaModelInfo[]
  error?: string
}

export interface OllamaPullResponse {
  success: boolean
  status?: 'success' | 'error' | 'pulling'
  message: string
  model: string
  error?: string
}

export interface OllamaDeployResponse {
  success: boolean
  message: string
  model: string
  status: 'pulling' | 'ready' | 'error'
}

export interface OllamaGenerateResponse {
  response: string
  model: string
  done: boolean
}

export interface PlatformProfile {
  name: string
  description: string
  model: string
  image: string
  gpu_count: number
  resources: {
    cpu_request: string
    cpu_limit: string
    mem_request: string
    mem_limit: string
  }
  vllm_flags: string
  supported_models: SupportedModel[]
  platform?: string
  runtime?: 'ollama' | 'vllm'
  is_compatible?: boolean
  incompatibility_reason?: string
}

export interface PlatformProfilesResponse {
  platform_name: string
  recommended_profiles: string[]
  profiles: PlatformProfile[]
  unsupported_profiles?: PlatformProfile[]
  network_speed_mbps?: number
}

export interface FeasibilityResponse {
  status: 'supported' | 'warning' | 'unsupported'
  actions: Array<{ action: string; reason: string }>
  recommended_profiles: string[]
  environment_config: Record<string, unknown>
  hardware: Record<string, unknown>
}

export interface PreflightCheck {
  check_name: string
  passed: boolean
  message: string
  recoverable: boolean
}

export interface PreflightResponse {
  all_passed: boolean
  checks: PreflightCheck[]
}

export interface DeployResponse {
  success: boolean
  message: string
  values_file?: string
  helm_output?: string
}

// Model feasibility information from profiles.yaml
export interface ModelFeasibility {
  size_gb: number
  memory_needed_gb: number
  context_length: number
  license: string
  gated: boolean
  gpu_verified: boolean
  feasibility: string  // "VERIFIED", "UNTESTED", "INCOMPATIBLE"
  note: string
  recommended: boolean
}

// API endpoint information
export interface ModelApiInfo {
  base_url: string
  generate_endpoint: string
  chat_endpoint: string
  embeddings_endpoint: string
  models_endpoint: string
  openai_compatible: boolean
  api_key_required: boolean
  api_key_env_var: string
}

// JSON Schema for model API
export interface ModelApiSchema {
  request_schema: Record<string, unknown>
  response_schema: Record<string, unknown>
  example_curl: string
  example_python: string
}

export interface ResourceInfo {
  resource_id: string
  resource_type: string
  state: string
  provision_id?: string
  cost_per_hour: number
  metadata: Record<string, unknown>
  kserve_ready: boolean
  model_state: string
  // Enhanced fields
  feasibility?: ModelFeasibility
  api_info?: ModelApiInfo
  api_schema?: ModelApiSchema
}

export interface ResourceListResponse {
  resources: ResourceInfo[]
  total_cost_per_hour: number
  has_active_resources: boolean
}

export interface CostBreakdown {
  total_cost_per_hour: number
  breakdown: Record<string, number>
  estimated_daily_cost: number
  estimated_monthly_cost: number
}

export interface DestroyResponse {
  success: boolean
  destroyed: string[]
  failed: string[]
  savings_per_hour: number
}

export interface SyncResponse {
  discovered: number
  registered: number
  already_tracked: number
  releases: string[]
}

// Dependency types
export type DependencyStatus = 'installed' | 'outdated' | 'missing' | 'check_failed' | 'optional_missing' | 'pending_cluster'
export type DependencyCategory = 'cli_tool' | 'cluster_component'

export interface DependencyInfo {
  name: string
  status: DependencyStatus
  required_version: string
  category: DependencyCategory
  installed_version: string | null
  message: string
  install_cmd: string
  requires_sudo: boolean
  optional: boolean
  order: number
  description: string
  docs_url: string
  requires_cluster: boolean
}

export interface DependencyStatusResponse {
  platform: string
  platform_description: string
  cluster_available: boolean
  cli_tools_satisfied: boolean
  cluster_components_satisfied: boolean
  all_satisfied: boolean
  cli_tools: DependencyInfo[]
  cluster_components: DependencyInfo[]
  dependencies: DependencyInfo[]
  missing_count: number
  outdated_count: number
}

export interface InstallResponse {
  success: boolean
  installed: string[]
  failed: string[]
  skipped: string[]
  errors: Record<string, string>
}

// Sudo password types
export interface SudoStatusResponse {
  available: boolean
  session_active: boolean
  message: string
  requires_password: boolean
}

export interface SudoValidateResponse {
  valid: boolean
  message: string
}

// WebSocket message types for installation
export interface WsPasswordRequired {
  type: 'password_required'
  dependency: string
  attempts_remaining: number
}

export interface WsPasswordInvalid {
  type: 'password_invalid'
  dependency: string
  attempts_remaining: number
}

export interface WsInstallProgress {
  type: 'progress'
  data: {
    dependency: string
    state: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
    message: string
    output?: string
  }
}

export interface WsInstallComplete {
  type: 'complete'
  data: {
    success: boolean
    installed: string[]
    failed: string[]
    skipped: string[]
  }
}

export interface WsError {
  type: 'error'
  message: string
}

export type WsInstallMessage = 
  | WsPasswordRequired 
  | WsPasswordInvalid 
  | WsInstallProgress 
  | WsInstallComplete 
  | WsError


// =============================================================================
// API Client
// =============================================================================

const BASE_URL = import.meta.env.DEV ? 'http://localhost:8000' : ''
const DEFAULT_TIMEOUT_MS = 30_000
const OLLAMA_PULL_TIMEOUT_MS = 18_000_000
const OLLAMA_GENERATE_TIMEOUT_MS = 300_000

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          console.error('Unauthorized - credentials may need refresh')
        }
        return Promise.reject(error)
      }
    )
  }

  // ---------------------------------------------------------------------------
  // Platform
  // ---------------------------------------------------------------------------

  async detectPlatform(): Promise<PlatformInfo> {
    const { data } = await this.client.get<PlatformInfo>('/api/v1/platform/detect')
    return data
  }

  async probeHardware(): Promise<HardwareProbe> {
    const { data } = await this.client.get<HardwareProbe>('/api/v1/platform/hardware')
    return data
  }

  async checkFeasibility(profileName: string): Promise<FeasibilityResponse> {
    const { data } = await this.client.post<FeasibilityResponse>(
      '/api/v1/platform/feasibility',
      { profile_name: profileName }
    )
    return data
  }

  async getK8sEngine(): Promise<{ recommended: string; alternatives: string[]; install_cmd: string; reason: string }> {
    const { data } = await this.client.get('/api/v1/platform/k8s-engine')
    return data
  }

  async getPlatformProfiles(): Promise<PlatformProfilesResponse> {
    const { data } = await this.client.get<PlatformProfilesResponse>('/api/v1/platform/profiles')
    return data
  }

  // ---------------------------------------------------------------------------
  // Credentials
  // ---------------------------------------------------------------------------

  async getCredentialStatus(): Promise<CredentialStatus> {
    const { data } = await this.client.get<CredentialStatus>('/api/v1/credentials/status')
    return data
  }

  async setupHuggingFace(token: string): Promise<{ success: boolean; error?: string }> {
    const { data } = await this.client.post('/api/v1/credentials/huggingface/setup', { token })
    return data
  }

  async deleteHuggingFace(): Promise<{ success: boolean }> {
    const { data } = await this.client.delete('/api/v1/credentials/huggingface')
    return data
  }

  async setupAWS(accessKey: string, secretKey: string, region: string): Promise<{ success: boolean; account_id?: string; error?: string }> {
    const { data } = await this.client.post('/api/v1/credentials/aws/setup', {
      access_key: accessKey,
      secret_key: secretKey,
      region,
    })
    return data
  }

  async testAWS(): Promise<{ success: boolean; account_id?: string; user_arn?: string; error?: string }> {
    const { data } = await this.client.get('/api/v1/credentials/aws/test')
    return data
  }

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------

  async listProfiles(): Promise<ProfileInfo[]> {
    const { data } = await this.client.get<{ profiles: ProfileInfo[] }>('/api/v1/deploy/profiles')
    return data.profiles
  }

  async getProfile(name: string): Promise<Record<string, unknown>> {
    const { data } = await this.client.get(`/api/v1/deploy/profiles/${name}`)
    return data
  }

  async runPreflight(profileName: string): Promise<PreflightResponse> {
    const { data } = await this.client.post<PreflightResponse>('/api/v1/deploy/preflight', {
      profile_name: profileName,
    })
    return data
  }

  async deploy(profile: string, release: string, namespace = 'llm', dryRun = false): Promise<DeployResponse> {
    const { data } = await this.client.post<DeployResponse>('/api/v1/deploy/', {
      profile,
      release,
      namespace,
      dry_run: dryRun,
    })
    return data
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async listResources(state?: string): Promise<ResourceListResponse> {
    const params = state ? { state } : {}
    const { data } = await this.client.get<ResourceListResponse>('/api/v1/lifecycle/resources', { params })
    return data
  }

  async getCostBreakdown(): Promise<CostBreakdown> {
    const { data } = await this.client.get<CostBreakdown>('/api/v1/lifecycle/cost')
    return data
  }

  async destroyResource(resourceId: string): Promise<DestroyResponse> {
    const { data } = await this.client.delete<DestroyResponse>(`/api/v1/lifecycle/resources/${resourceId}`)
    return data
  }

  async destroyAll(): Promise<DestroyResponse> {
    const { data } = await this.client.post<DestroyResponse>('/api/v1/lifecycle/destroy-all')
    return data
  }

  async getOrphanedResources(): Promise<ResourceInfo[]> {
    const { data } = await this.client.get<ResourceInfo[]>('/api/v1/lifecycle/orphaned')
    return data
  }

  async syncResources(namespace = 'llm'): Promise<SyncResponse> {
    const { data } = await this.client.post<SyncResponse>('/api/v1/lifecycle/sync', null, {
      params: { namespace },
    })
    return data
  }

  // ---------------------------------------------------------------------------
  // Dependencies
  // ---------------------------------------------------------------------------

  async getDependencyStatus(platform?: string): Promise<DependencyStatusResponse> {
    const params = platform ? { platform } : {}
    const { data } = await this.client.get<DependencyStatusResponse>('/api/v1/deps/status', { params })
    return data
  }

  async checkSingleDependency(depName: string, platform?: string): Promise<DependencyInfo> {
    const params = platform ? { platform } : {}
    const { data } = await this.client.get<DependencyInfo>(`/api/v1/deps/status/${depName}`, { params })
    return data
  }

  async installDependencies(
    dependencies?: string[],
    platform?: string,
    skipOptional = false
  ): Promise<InstallResponse> {
    const { data } = await this.client.post<InstallResponse>('/api/v1/deps/install', {
      platform,
      dependencies,
      skip_optional: skipOptional,
    })
    return data
  }

  async installSingleDependency(depName: string, platform?: string): Promise<{ success: boolean; dependency: string; message: string }> {
    const params = platform ? { platform } : {}
    const { data } = await this.client.post(`/api/v1/deps/install/${depName}`, null, { params })
    return data
  }

  async getCurrentPlatform(): Promise<{ platform: string; description: string; is_supported: boolean }> {
    const { data } = await this.client.get('/api/v1/deps/current-platform')
    return data
  }

  async listAvailablePlatforms(): Promise<{ platforms: Array<{ name: string; description: string; dependency_count: number }> }> {
    const { data } = await this.client.get('/api/v1/deps/platforms')
    return data
  }

  async getSudoStatus(): Promise<SudoStatusResponse> {
    const { data } = await this.client.get<SudoStatusResponse>('/api/v1/deps/sudo/status')
    return data
  }

  async validateSudoPassword(password: string): Promise<SudoValidateResponse> {
    const { data } = await this.client.post<SudoValidateResponse>('/api/v1/deps/sudo/validate', { password })
    return data
  }

  // ---------------------------------------------------------------------------
  // Ollama (GPU Inference for DGX Spark)
  // ---------------------------------------------------------------------------

  async getOllamaStatus(): Promise<OllamaStatusResponse> {
    const { data } = await this.client.get<OllamaStatusResponse>('/api/v1/ollama/status')
    return data
  }

  async listOllamaModels(): Promise<OllamaModelInfo[]> {
    const { data } = await this.client.get<OllamaModelInfo[]>('/api/v1/ollama/models')
    return data
  }

  async pullOllamaModel(model: string): Promise<OllamaPullResponse> {
    const { data } = await this.client.post<OllamaPullResponse>(
      '/api/v1/ollama/pull',
      { model },
      { timeout: OLLAMA_PULL_TIMEOUT_MS }
    )
    return data
  }

  async deployOllamaModel(model: string, profile = 'dgx_spark'): Promise<OllamaDeployResponse> {
    const { data } = await this.client.post<OllamaDeployResponse>(
      '/api/v1/ollama/deploy',
      { model, profile },
      { timeout: OLLAMA_PULL_TIMEOUT_MS }
    )
    return data
  }

  async deleteOllamaModel(modelName: string): Promise<{ success: boolean; message: string }> {
    const { data } = await this.client.delete(`/api/v1/ollama/models/${encodeURIComponent(modelName)}`)
    return data
  }

  async generateOllamaText(model: string, prompt: string): Promise<OllamaGenerateResponse> {
    const { data } = await this.client.post<OllamaGenerateResponse>(
      '/api/v1/ollama/generate',
      {
        model,
        prompt,
        stream: false,
      },
      { timeout: OLLAMA_GENERATE_TIMEOUT_MS }
    )
    return data
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async checkHealth(): Promise<{ status: string }> {
    const { data } = await this.client.get('/health')
    return data
  }
}

// Export singleton instance
export const api = new ApiClient()
