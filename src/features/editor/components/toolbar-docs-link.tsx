import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * Toolbar link to the built-in NodarCut documentation. Rendered in both
 * standalone and embedded modes; opens in a new tab so it also works from
 * inside the studio iframe.
 */
export function ToolbarDocsLink() {
  const { t } = useTranslation()
  const label = t('toolbar.userGuide')

  return (
    <Button variant="outline" size="icon" className="h-7 w-7" asChild>
      <a
        href="/docs"
        target="_blank"
        rel="noopener noreferrer"
        data-tooltip={label}
        data-tooltip-side="bottom"
        aria-label={label}
      >
        <BookOpen className="h-4 w-4" />
      </a>
    </Button>
  )
}
