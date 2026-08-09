import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * Labeled export action for the embedded toolbar, where the standalone
 * export dropdown is hidden. Opens the same export dialog as Ctrl+Shift+E.
 */
export function ToolbarExportButton({ onExport }: { onExport?: () => void }) {
  const { t } = useTranslation()

  if (!onExport) return null

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={onExport}>
      <Download className="h-4 w-4" />
      {t('toolbar.export')}
    </Button>
  )
}
