import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { CircleDot, Pipette, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KeyframeToggle } from '@/features/effects/deps/keyframes-contract'
import { PropertyRow, SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { getEffectDefinitionName, getEffectParamLabel } from '@/features/effects/utils/effect-i18n'
import { EffectPanelHeaderRow } from './effect-panel-header-actions'
import type { GpuKeyframePanelProps, GpuParamUpdates } from './panel-props'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'

interface GpuWheelsPanelProps extends GpuKeyframePanelProps {
  layout?: 'sidebar' | 'dock'
  onParamsBatchChange: (effectId: string, updates: GpuParamUpdates) => void
  onParamsBatchLiveChange: (effectId: string, updates: GpuParamUpdates) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const MAX_WHEEL_SIZE = 100
const MAX_DOCK_WHEEL_SIZE = 220
const MIN_WHEEL_SIZE = 64
const MIN_DOCK_WHEEL_SIZE = 136
const GRID_GAP_PX = 4
const PUCK_RADIUS_PX = 4

function getHueAmountFromClient(clientX: number, clientY: number, element: HTMLButtonElement) {
  const rect = element.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const trackRadius = Math.max(1, rect.width / 2 - PUCK_RADIUS_PX - 1)
  const amount = clamp(dist / trackRadius, 0, 1)
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  return { hue, amount }
}

interface WheelControlProps {
  label: string
  hue: number
  amount: number
  size: number
  disabled: boolean
  compact?: boolean
  dock?: boolean
  valueStrip?: React.ReactNode
  onLiveChange: (hue: number, amount: number) => void
  onCommit: (hue: number, amount: number) => void
  onReset: () => void
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

const KEYBOARD_WHEEL_ACTIONS = {
  ArrowLeft: (hue: number, amount: number) => [hue - 1, amount],
  ArrowRight: (hue: number, amount: number) => [hue + 1, amount],
  ArrowDown: (hue: number, amount: number) => [hue, amount - 0.01],
  ArrowUp: (hue: number, amount: number) => [hue, amount + 0.01],
  Home: (hue: number) => [hue, 0],
  End: (hue: number) => [hue, 1],
} satisfies Record<string, (hue: number, amount: number) => [number, number]>

function getKeyboardWheelTarget(key: string, hue: number, amount: number): [number, number] | null {
  return KEYBOARD_WHEEL_ACTIONS[key as keyof typeof KEYBOARD_WHEEL_ACTIONS]?.(hue, amount) ?? null
}

function getDockWheelShadow(dock: boolean) {
  return dock
    ? '0 0 0 3px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.18)'
    : undefined
}

function readNumberParam(
  definition: GpuEffectDefinition,
  params: Record<string, number | boolean | string>,
  key: string,
  fallback = 0,
) {
  const value = params[key]
  const defaultValue = definition.params[key]?.default
  if (typeof value === 'number') return value
  if (typeof defaultValue === 'number') return defaultValue
  return fallback
}

function clampParamValue(param: GpuEffectDefinition['params'][string] | undefined, value: number) {
  const min = typeof param?.min === 'number' ? param.min : value
  const max = typeof param?.max === 'number' ? param.max : value
  return clamp(value, min, max)
}

function DockWheelHeader({
  dock,
  label,
  resetLabel,
  disabled,
  onReset,
}: {
  dock: boolean
  label: string
  resetLabel: string
  disabled: boolean
  onReset: () => void
}) {
  if (!dock) return null
  return (
    <div className="flex h-5 w-full items-center justify-center gap-1">
      <span className="truncate text-[11px] font-semibold text-foreground">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-muted-foreground"
        onClick={onReset}
        disabled={disabled}
        title={resetLabel}
        aria-label={resetLabel}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </div>
  )
}

function DockWheelCrosshair({ dock }: { dock: boolean }) {
  if (!dock) return null
  return (
    <>
      <span className="absolute left-1/2 top-[8%] h-[84%] w-px -translate-x-1/2 bg-white/18" />
      <span className="absolute left-[8%] top-1/2 h-px w-[84%] -translate-y-1/2 bg-white/18" />
    </>
  )
}

function SidebarWheelReadout({
  dock,
  label,
  hue,
  amount,
}: {
  dock: boolean
  label: string
  hue: number
  amount: number
}) {
  if (dock) return null
  return (
    <>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-[10px] font-mono text-muted-foreground">
        {Math.round(hue)} deg | {Math.round(amount * 100)}%
      </div>
    </>
  )
}

function SidebarResetButton({
  compact,
  dock,
  resetLabel,
  disabled,
  onReset,
}: {
  compact: boolean
  dock: boolean
  resetLabel: string
  disabled: boolean
  onReset: () => void
}) {
  if (compact || dock) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5"
      onClick={onReset}
      disabled={disabled}
      title={resetLabel}
      aria-label={resetLabel}
    >
      <RotateCcw className="w-3 h-3" />
    </Button>
  )
}

const WheelControl = memo(function WheelControl({
  label,
  hue,
  amount,
  size,
  disabled,
  compact = false,
  dock = false,
  valueStrip,
  onLiveChange,
  onCommit,
  onReset,
}: WheelControlProps) {
  const { t } = useTranslation()
  const wheelRef = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [localHue, setLocalHue] = useState(hue)
  const [localAmount, setLocalAmount] = useState(clamp(amount, 0, 1))

  useEffect(() => {
    if (!dragging) {
      setLocalHue(hue)
      setLocalAmount(clamp(amount, 0, 1))
    }
  }, [amount, dragging, hue])

  const updateFromPointer = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const el = wheelRef.current
      if (!el) return null
      const next = getHueAmountFromClient(event.clientX, event.clientY, el)
      setLocalHue(next.hue)
      setLocalAmount(next.amount)
      onLiveChange(next.hue, next.amount)
      return next
    },
    [onLiveChange],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) return
      const el = wheelRef.current
      if (!el) return
      el.setPointerCapture(event.pointerId)
      setDragging(true)
      updateFromPointer(event)
    },
    [disabled, updateFromPointer],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !dragging) return
      updateFromPointer(event)
    },
    [disabled, dragging, updateFromPointer],
  )

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || !dragging) return
      const next = updateFromPointer(event)
      if (next) {
        onCommit(next.hue, next.amount)
      } else {
        onCommit(localHue, localAmount)
      }
      setDragging(false)
    },
    [disabled, dragging, localAmount, localHue, onCommit, updateFromPointer],
  )

  const handlePointerCancel = useCallback(() => {
    if (!dragging) return
    onCommit(localHue, localAmount)
    setDragging(false)
  }, [dragging, localAmount, localHue, onCommit])

  const commitKeyboardChange = useCallback(
    (nextHue: number, nextAmount: number) => {
      const normalizedHue = wrapHue(nextHue)
      const normalizedAmount = clamp(nextAmount, 0, 1)
      setLocalHue(normalizedHue)
      setLocalAmount(normalizedAmount)
      onLiveChange(normalizedHue, normalizedAmount)
      onCommit(normalizedHue, normalizedAmount)
    },
    [onCommit, onLiveChange],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      const target = getKeyboardWheelTarget(event.key, localHue, localAmount)
      if (!target) return
      event.preventDefault()
      commitKeyboardChange(target[0], target[1])
    },
    [commitKeyboardChange, disabled, localAmount, localHue],
  )

  const displayTrackRadius = size / 2 - PUCK_RADIUS_PX - 1
  const puckX = Math.cos((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount)
  const puckY = Math.sin((localHue * Math.PI) / 180) * (displayTrackRadius * localAmount)
  const resetLabel = t('effects.wheels.resetWheel', { name: label })

  return (
    <div className={cn('flex min-w-0 flex-col items-center gap-1', compact && 'gap-0.5')}>
      <DockWheelHeader
        dock={dock}
        label={label}
        resetLabel={resetLabel}
        disabled={disabled}
        onReset={onReset}
      />
      <button
        ref={wheelRef}
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={t('effects.wheels.adjustWheel', {
          name: label,
          defaultValue: `Adjust ${label} wheel`,
        })}
        className={`relative rounded-full border border-border/70 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-crosshair'}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          touchAction: 'none',
          boxShadow: getDockWheelShadow(dock),
          backgroundImage:
            'radial-gradient(circle at center, hsl(0 0% 18%) 0%, hsl(0 0% 10%) 26%, transparent 28%), conic-gradient(from 0deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #ff2d55, #ff3b30)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        <DockWheelCrosshair dock={dock} />
        <div
          className="absolute rounded-full border border-black/60 shadow-sm"
          style={{
            width: `${PUCK_RADIUS_PX * 2}px`,
            height: `${PUCK_RADIUS_PX * 2}px`,
            background: '#f8fafc',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${puckX}px, ${puckY}px)`,
          }}
        />
      </button>
      <SidebarWheelReadout dock={dock} label={label} hue={localHue} amount={localAmount} />
      {dock && valueStrip}
      <SidebarResetButton
        compact={compact}
        dock={dock}
        resetLabel={resetLabel}
        disabled={disabled}
        onReset={onReset}
      />
    </div>
  )
})

const WHEEL_DESCRIPTORS = [
  { labelKey: 'effects.wheels.shadows', hueKey: 'shadowsHue', amountKey: 'shadowsAmount' },
  { labelKey: 'effects.wheels.midtones', hueKey: 'midtonesHue', amountKey: 'midtonesAmount' },
  { labelKey: 'effects.wheels.highlights', hueKey: 'highlightsHue', amountKey: 'highlightsAmount' },
] as const

const DOCK_WHEEL_DESCRIPTORS = [
  {
    labelKey: 'effects.params.lift',
    hueKey: 'shadowsHue',
    amountKey: 'shadowsAmount',
    levelKey: 'lift',
  },
  {
    labelKey: 'effects.params.gamma',
    hueKey: 'midtonesHue',
    amountKey: 'midtonesAmount',
    levelKey: 'gamma',
  },
  {
    labelKey: 'effects.params.gain',
    hueKey: 'highlightsHue',
    amountKey: 'highlightsAmount',
    levelKey: 'gain',
  },
  {
    labelKey: 'effects.params.offset',
    hueKey: 'offsetHue',
    amountKey: 'offsetAmount',
    levelKey: 'offset',
  },
] as const

const DOCK_TOP_PARAMS = ['temperature', 'tint', 'contrast', 'pivot', 'midDetail'] as const
const DOCK_BOTTOM_PARAMS = [
  'colorBoost',
  'shadows',
  'highlights',
  'saturation',
  'hue',
  'lumMix',
] as const

const PRIMARY_PARAMS = [
  'exposure',
  'contrast',
  'pivot',
  'lift',
  'gamma',
  'gain',
  'offset',
  'blackPoint',
  'whitePoint',
] as const

const TONAL_PARAMS = ['temperature', 'tint', 'saturation'] as const

function getParamDecimals(step: unknown): number {
  if (typeof step !== 'number') return 2
  if (step >= 1) return 0
  if (step >= 0.01) return 2
  return 3
}

function formatParamValue(value: number, step: unknown): string {
  return value.toFixed(getParamDecimals(step))
}

function getDockParamAccent(key: string): string {
  if (key === 'temperature' || key === 'contrast' || key === 'pivot' || key === 'lumMix') {
    return 'from-zinc-200 via-zinc-500 to-zinc-900'
  }
  if (key === 'tint' || key === 'hue') return 'from-cyan-400 via-fuchsia-500 to-amber-300'
  if (key === 'saturation' || key === 'colorBoost') {
    return 'from-red-500 via-green-500 to-blue-500'
  }
  return 'from-zinc-300 via-red-500 to-blue-500'
}

export const GpuWheelsPanel = memo(function GpuWheelsPanel({
  itemIds,
  effect,
  gpuEffect,
  definition,
  layout = 'sidebar',
  getKeyframeProperty,
  onParamChange,
  onParamLiveChange,
  onParamsBatchChange,
  onParamsBatchLiveChange,
  onReset,
  onToggle,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: GpuWheelsPanelProps) {
  const { t } = useTranslation()
  const wheelGridRef = useRef<HTMLDivElement>(null)
  const [wheelSize, setWheelSize] = useState(MAX_WHEEL_SIZE)
  const isDock = layout === 'dock'

  const paramEntries = Object.entries(definition.params)
  const isDefault = paramEntries.every(([key, param]) => gpuEffect.params[key] === param.default)

  useEffect(() => {
    const el = wheelGridRef.current
    if (!el) return

    const updateSize = () => {
      const width = el.clientWidth
      const wheelCount = isDock ? DOCK_WHEEL_DESCRIPTORS.length : WHEEL_DESCRIPTORS.length
      const maxSize = isDock ? MAX_DOCK_WHEEL_SIZE : MAX_WHEEL_SIZE
      const minSize = isDock ? MIN_DOCK_WHEEL_SIZE : MIN_WHEEL_SIZE
      const slotWidth = (width - GRID_GAP_PX * (wheelCount - 1)) / wheelCount
      setWheelSize(clamp(Math.floor(slotWidth), minSize, maxSize))
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(el)
    return () => observer.disconnect()
  }, [isDock])

  const tonalRowClass = '[&>span]:w-[84px] [&>span]:min-w-[84px]'
  const renderNumberControl = (key: string) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const value = (gpuEffect.params[key] as number) ?? param.default
    const label = getEffectParamLabel(t, definition, key)

    return (
      <label key={key} className="flex min-w-0 items-center justify-center gap-1.5">
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        <span className="flex min-w-[4.25rem] flex-col items-center">
          <input
            aria-label={label}
            type="number"
            value={formatParamValue(value, param.step)}
            min={param.min}
            max={param.max}
            step={param.step}
            disabled={!effect.enabled}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              const clamped = clamp(next, param.min ?? next, param.max ?? next)
              onParamLiveChange(effect.id, key, clamped)
              onParamChange(effect.id, key, clamped)
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="h-6 w-[4.25rem] rounded-[2px] border border-black/80 bg-black/75 px-1 text-center font-mono text-[11px] text-foreground shadow-inner outline-none focus:border-ring"
          />
          <span
            aria-hidden="true"
            className={cn('mt-0.5 h-0.5 w-8 rounded-full bg-gradient-to-r', getDockParamAccent(key))}
          />
        </span>
      </label>
    )
  }

  const renderWheelValueStrip = (levelKey: string, hueKey: string, amountKey: string) => {
    const levelParam = definition.params[levelKey]
    const levelValue = readNumberParam(definition, gpuEffect.params, levelKey)
    const hue = readNumberParam(definition, gpuEffect.params, hueKey)
    const amount = readNumberParam(definition, gpuEffect.params, amountKey)
    const chips = [
      { value: Math.round(amount * 100).toString(), className: 'border-b-red-500' },
      { value: Math.round(hue).toString(), className: 'border-b-green-500' },
      { value: Math.round((amount * hue) / 360).toString(), className: 'border-b-blue-500' },
    ]

    return (
      <div className="mt-1 w-full px-1">
        <div className="grid grid-cols-4 gap-1">
          <input
            aria-label={getEffectParamLabel(t, definition, levelKey)}
            type="number"
            value={formatParamValue(levelValue, levelParam?.step)}
            min={levelParam?.min}
            max={levelParam?.max}
            step={levelParam?.step}
            disabled={!effect.enabled}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              const clamped = clampParamValue(levelParam, next)
              onParamLiveChange(effect.id, levelKey, clamped)
              onParamChange(effect.id, levelKey, clamped)
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="h-5 rounded-[2px] border border-black/80 border-b-white bg-black/75 px-1 text-center font-mono text-[10px] leading-5 text-foreground outline-none focus:border-ring"
          />
          {chips.map((chip, index) => (
            <div
              key={index}
              className={cn(
                'h-5 rounded-[2px] border border-black/80 bg-black/75 text-center font-mono text-[10px] leading-5 text-foreground',
                chip.className,
              )}
            >
              {chip.value}
            </div>
          ))}
        </div>
        <div className="mt-1 h-2 rounded-full border border-black/80 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.16)_0_1px,rgba(0,0,0,0.55)_1px_4px)] shadow-inner" />
      </div>
    )
  }

  const renderParamRows = (keys: readonly string[]) =>
    keys.map((key) => {
      const param = definition.params[key]
      if (!param) return null
      const value = (gpuEffect.params[key] as number) ?? param.default
      const keyframeProperty = getKeyframeProperty(effect.id, key)
      return (
        <PropertyRow
          key={key}
          label={getEffectParamLabel(t, definition, key)}
          className={tonalRowClass}
        >
          <div className="flex items-center gap-1 min-w-0 w-full">
            <SliderInput
              value={value}
              onChange={(v) => onParamChange(effect.id, key, v)}
              onLiveChange={(v) => onParamLiveChange(effect.id, key, v)}
              min={param.min ?? -100}
              max={param.max ?? 100}
              step={param.step ?? 1}
              disabled={!effect.enabled}
              className="flex-1 min-w-0"
            />
            {keyframeProperty ? (
              <KeyframeToggle
                itemIds={itemIds}
                property={keyframeProperty}
                currentValue={value}
                disabled={!effect.enabled}
              />
            ) : null}
          </div>
        </PropertyRow>
      )
    })

  return (
    <div className={cn('space-y-0', isDock && 'flex h-full min-h-0 flex-col overflow-hidden')}>
      <EffectPanelHeaderRow
        label={
          isDock ? t('effects.wheels.primariesColorWheels') : getEffectDefinitionName(definition)
        }
        effectId={effect.id}
        enabled={effect.enabled}
        isDefault={isDefault}
        onReset={onReset}
        onToggle={onToggle}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />

      {isDock ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="grid h-10 shrink-0 grid-cols-[4.25rem_repeat(5,minmax(0,1fr))] items-center gap-3 border-b border-border/70 px-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground/50 text-[10px] font-semibold">
                A
              </span>
              <Pipette className="h-3.5 w-3.5" aria-hidden="true" />
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            {DOCK_TOP_PARAMS.map(renderNumberControl)}
          </div>
          <div className="min-h-0 flex-1 px-5 py-2">
            <div ref={wheelGridRef} className="grid h-full grid-cols-4 items-center gap-5">
              {DOCK_WHEEL_DESCRIPTORS.map((desc) => (
                <WheelControl
                  key={desc.labelKey}
                  label={t(desc.labelKey)}
                  hue={(gpuEffect.params[desc.hueKey] as number) ?? 0}
                  amount={(gpuEffect.params[desc.amountKey] as number) ?? 0}
                  size={wheelSize}
                  disabled={!effect.enabled}
                  dock
                  valueStrip={renderWheelValueStrip(desc.levelKey, desc.hueKey, desc.amountKey)}
                  onLiveChange={(hue, amount) => {
                    onParamsBatchLiveChange(effect.id, {
                      [desc.hueKey]: hue,
                      [desc.amountKey]: amount,
                    })
                  }}
                  onCommit={(hue, amount) => {
                    onParamsBatchChange(effect.id, {
                      [desc.hueKey]: hue,
                      [desc.amountKey]: amount,
                    })
                  }}
                  onReset={() => {
                    onParamsBatchChange(effect.id, {
                      [desc.hueKey]: 0,
                      [desc.amountKey]: 0,
                    })
                  }}
                />
              ))}
            </div>
          </div>
          <div className="grid h-10 shrink-0 grid-cols-6 items-center gap-3 border-t border-border/70 px-3">
            {DOCK_BOTTOM_PARAMS.map(renderNumberControl)}
          </div>
          <div className="flex h-5 shrink-0 items-center justify-center gap-5 border-t border-border/50 bg-black/10 text-muted-foreground">
            <CircleDot className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <Pipette className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>
      ) : (
        <div className="px-2 pb-2">
          <div ref={wheelGridRef} className="grid grid-cols-3 gap-1">
            {WHEEL_DESCRIPTORS.map((desc) => (
              <WheelControl
                key={desc.labelKey}
                label={t(desc.labelKey)}
                hue={(gpuEffect.params[desc.hueKey] as number) ?? 0}
                amount={(gpuEffect.params[desc.amountKey] as number) ?? 0}
                size={wheelSize}
                disabled={!effect.enabled}
                onLiveChange={(hue, amount) => {
                  onParamsBatchLiveChange(effect.id, {
                    [desc.hueKey]: hue,
                    [desc.amountKey]: amount,
                  })
                }}
                onCommit={(hue, amount) => {
                  onParamsBatchChange(effect.id, {
                    [desc.hueKey]: hue,
                    [desc.amountKey]: amount,
                  })
                }}
                onReset={() => {
                  onParamsBatchChange(effect.id, {
                    [desc.hueKey]: 0,
                    [desc.amountKey]: 0,
                  })
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!isDock && (
        <>
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.wheels.primaries', { defaultValue: 'Primaries' })}
          </div>
          {renderParamRows(PRIMARY_PARAMS)}

          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('effects.wheels.balance', { defaultValue: 'Balance' })}
          </div>
          {renderParamRows(TONAL_PARAMS)}
        </>
      )}
    </div>
  )
})
