import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PropertyRow } from '@/shared/ui/property-controls'
import { EffectMoveButtons, type EffectMoveProps } from './effect-move-buttons'

interface EffectPanelHeaderActionsProps extends EffectMoveProps {
  effectId: string
  enabled: boolean
  isDefault: boolean
  onReset: (effectId: string) => void
  onToggle: (effectId: string) => void
  onRemove: (effectId: string) => void
}

export function EffectPanelHeaderActions({
  effectId,
  enabled,
  isDefault,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: EffectPanelHeaderActionsProps) {
  const { t } = useTranslation()
  const resetLabel = t('effects.panel.resetToDefaults')
  const toggleLabel = enabled ? t('effects.panel.disableEffect') : t('effects.panel.enableEffect')
  const removeLabel = t('effects.panel.removeEffect')

  return (
    <>
      <EffectMoveButtons
        effectId={effectId}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
      <Button
        variant="ghost"
        size="icon"
        className={`h-6 w-6 flex-shrink-0 ${isDefault ? 'opacity-30' : ''}`}
        onClick={() => onReset(effectId)}
        title={resetLabel}
        aria-label={resetLabel}
        disabled={isDefault}
      >
        <RotateCcw className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onToggle(effectId)}
        title={toggleLabel}
        aria-label={toggleLabel}
      >
        {enabled ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3 text-muted-foreground" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={() => onRemove(effectId)}
        title={removeLabel}
        aria-label={removeLabel}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </>
  )
}

interface EffectPanelHeaderRowProps extends EffectPanelHeaderActionsProps {
  label: string
}

export function EffectPanelHeaderRow({ label, ...actions }: EffectPanelHeaderRowProps) {
  return (
    <PropertyRow label={label}>
      <div className="flex items-center gap-1 min-w-0 w-full justify-end">
        <EffectPanelHeaderActions {...actions} />
      </div>
    </PropertyRow>
  )
}
