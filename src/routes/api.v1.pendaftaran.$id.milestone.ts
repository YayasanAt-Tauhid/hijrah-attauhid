import { createFileRoute } from '@tanstack/react-router'
import { handleMilestoneUpdate } from '@/server/integrationApiMilestone'

export const Route = createFileRoute('/api/v1/pendaftaran/$id/milestone')({
  server: {
    handlers: {
      POST: ({ request, params }) => handleMilestoneUpdate(request, params.id),
    },
  },
})
