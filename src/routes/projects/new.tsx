import { createFileRoute } from '@tanstack/react-router'
import { createLogger } from '@/shared/logging/logger'
import { useProjectStore } from '@/features/projects/stores/project-store'

const logger = createLogger('NewProjectRoute')

export const Route = createFileRoute('/projects/new')({
  beforeLoad: async () => {
    try {
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})
