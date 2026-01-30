import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WizardShell } from './wizard/WizardShell'
import { PlatformStep } from './wizard/steps/PlatformStep'
import { CredentialStep } from './wizard/steps/CredentialStep'
import { DependencyStep } from './wizard/steps/DependencyStep'
import { ProfileStep } from './wizard/steps/ProfileStep'
import { DeployStep } from './wizard/steps/DeployStep'
import { DashboardStep } from './wizard/steps/DashboardStep'

function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<WizardShell />}>
          <Route index element={<Navigate to="/step/platform" replace />} />
          <Route path="step/platform" element={<PlatformStep />} />
          <Route path="step/credentials" element={<CredentialStep />} />
          <Route path="step/dependencies" element={<DependencyStep />} />
          <Route path="step/profile" element={<ProfileStep />} />
          <Route path="step/deploy" element={<DeployStep />} />
          <Route path="step/dashboard" element={<DashboardStep />} />
          {/* Catch-all: redirect unknown routes to platform step */}
          <Route path="*" element={<Navigate to="/step/platform" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
