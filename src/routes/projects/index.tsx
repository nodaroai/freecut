import { createFileRoute } from '@tanstack/react-router'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { cleanupBlobUrls } from '@/features/media-library/utils/media-resolver'

export const Route = createFileRoute('/projects/')({
  // Clean up any media blob URLs when returning to projects page.
  beforeLoad: async () => {
    cleanupBlobUrls()
    // Always reload projects from storage to get fresh data (thumbnails may have changed).
    const { loadProjects } = useProjectStore.getState()
    await loadProjects()
  },
})
