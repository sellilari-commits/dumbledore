/** Home — placeholder while the page is being built. */
import { PageFrame } from '../PageFrame'

export function HomePage() {
  return (
    <PageFrame crumbs={[{ label: 'Home' }]}>
      <p style={{ paddingTop: 80 }}>Home</p>
    </PageFrame>
  )
}
