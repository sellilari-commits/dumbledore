/** Fallback for unknown app routes. */
import { Button, EmptyState } from '@renderer/design-system'
import { useLocation } from 'wouter'
import { PageFrame } from './PageFrame'

export function NotFoundPage() {
  const [location, navigate] = useLocation()
  return (
    <PageFrame crumbs={[{ label: 'Not found' }]}>
      <EmptyState
        icon="🔍"
        title="This page doesn’t exist"
        actions={
          <Button variant="primary" onClick={() => navigate('/home')}>
            Go home
          </Button>
        }
      >
        Nothing lives at <code>{location}</code>.
      </EmptyState>
    </PageFrame>
  )
}
