import { memo } from 'react'
import { Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ColorGradePanel } from './properties-sidebar/color-grade-panel'

export const ColorGradingDock = memo(function ColorGradingDock() {
  const { t } = useTranslation()

  return (
    <section
      className="panel-bg flex h-full min-h-0 flex-col border-t border-border"
      aria-label={t('editor.colorPanel.dockLabel')}
      data-testid="color-grading-dock"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <Palette className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('editor.colorPanel.dockTitle')}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <ColorGradePanel layout="dock" />
      </div>
    </section>
  )
})
