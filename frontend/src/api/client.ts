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

export interface ResourceInfo {
  resource_id: string
  resource_type: string
  state: string
  provision_id?: string
  cost_per_hour: number
  metadata: Record<string, unknown>
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


// =============================================================================
// API Client
// =============================================================================

const BASE_URL = import.meta.env.DEV ? 'http://localhost:8000' : ''

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
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
