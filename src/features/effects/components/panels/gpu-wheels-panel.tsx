import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
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
const MAX_DOCK_WHEEL_SIZE = 200
const MIN_WHEEL_SIZE = 64
const MIN_DOCK_WHEEL_SIZE = 48
const GRID_GAP_PX = 4
const DOCK_WHEEL_GRID_GAP_PX = 28
// Vertical space each dock wheel column needs besides the wheel itself:
// header (20) + column gaps (2x8) + value chips with accents (24) + thumb wheel (16)
const DOCK_WHEEL_EXTRAS_PX = 76
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
  dockFields?: React.ReactNode
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
  return dock ? '0 0 0 3px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.18)' : undefined
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
  dockFields,
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
    <div
      className={cn(
        'flex min-w-0 flex-col items-center',
        dock ? 'gap-2' : 'gap-1',
        compact && 'gap-0.5',
      )}
    >
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
      {dock && dockFields}
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

function getDockFieldAccent(key: string): string {
  if (key.endsWith('Hue')) return 'bg-emerald-500'
  if (key.endsWith('Amount')) return 'bg-red-500'
  if (key === 'lift' || key === 'gamma' || key === 'gain' || key === 'offset') {
    return 'bg-zinc-200'
  }
  return 'bg-blue-500'
}

function formatWheelChipValue(key: string, value: number, step: unknown): string {
  if (key.endsWith('Hue')) return Math.round(value).toString()
  return formatParamValue(value, step)
}

const THUMB_WHEEL_CLASS =
  'mt-1 h-3 w-full cursor-ew-resize appearance-none rounded-full border border-black/80 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.22)_0_1px,rgba(0,0,0,0.65)_1px_5px)] shadow-inner disabled:cursor-not-allowed disabled:opacity-60 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/80 [&::-moz-range-thumb]:bg-zinc-200 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/80 [&::-webkit-slider-thumb]:bg-zinc-200'

/**
 * Range slider that previews live while dragging and commits once on release.
 * React fires `onChange` for range inputs on every input event, so committing
 * there would push a timeline mutation (and undo entry) per dragged pixel —
 * local drag state keeps the thumb responsive without re-rendering the panel.
 */
const DockThumbWheel = memo(function DockThumbWheel({
  ariaLabel,
  name,
  value,
  min,
  max,
  step,
  disabled,
  onLive,
  onCommit,
}: {
  ariaLabel: string
  name: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled: boolean
  onLive: (value: string) => void
  onCommit: (value: string) => void
}) {
  const [dragValue, setDragValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    setDragValue(null)
    onCommit(raw)
  }

  return (
    <input
      aria-label={ariaLabel}
      type="range"
      name={name}
      value={dragValue ?? value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.currentTarget.value
        setDragValue(raw)
        onLive(raw)
      }}
      onPointerUp={(event) => commit(event.currentTarget.value)}
      onPointerCancel={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => {
        if (dragValue !== null) commit(event.currentTarget.value)
      }}
      onBlur={(event) => {
        if (dragValue !== null) commit(event.currentTarget.value)
      }}
      className={THUMB_WHEEL_CLASS}
    />
  )
})

const SCRUB_THRESHOLD_PX = 3

/**
 * Horizontal-scrub numeric field (After Effects style): dragging anywhere on
 * the field slides the value by one step per pixel (Shift = 0.1x fine), a
 * plain click opens text editing. While interacting only the cheap live
 * preview path runs; the timeline commit (undo entry + auto-keyframe scan)
 * lands once per gesture — on release, Enter, blur, or arrow-key release.
 */
const DockNumberInput = memo(function DockNumberInput({
  ariaLabel,
  name,
  value,
  min,
  max,
  step = 1,
  disabled,
  className,
  onLive,
  onCommit,
}: {
  ariaLabel?: string
  name: string
  value: string
  min?: number
  max?: number
  step?: number
  disabled: boolean
  className: string
  onLive: (raw: string) => void
  onCommit: (raw: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  // Ref mirror of draft — blur fires synchronously after Enter/Escape, before
  // React applies the state update, so guards must not read stale state.
  const draftRef = useRef<string | null>(null)
  const dragRef = useRef<{ startX: number; startValue: number; scrubbed: boolean } | null>(null)

  const updateDraft = (raw: string | null) => {
    draftRef.current = raw
    setDraft(raw)
  }

  const decimals = getParamDecimals(step)

  const clampValue = (next: number) => {
    let result = next
    if (min !== undefined) result = Math.max(min, result)
    if (max !== undefined) result = Math.min(max, result)
    return result
  }

  const commit = (raw: string) => {
    updateDraft(null)
    onCommit(raw)
  }

  const revert = () => {
    updateDraft(null)
    onLive(value)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || event.button !== 0) return
    // Already editing — let the caret/selection behave normally.
    if (document.activeElement === inputRef.current) return
    // Keep focus off until release decides between scrub and click-to-edit.
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const parsed = Number(value)
    dragRef.current = {
      startX: event.clientX,
      startValue: Number.isFinite(parsed) ? parsed : 0,
      scrubbed: false,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (!drag.scrubbed && Math.abs(dx) < SCRUB_THRESHOLD_PX) return
    drag.scrubbed = true
    const sensitivity = event.shiftKey ? 0.1 : 1
    const raw = clampValue(drag.startValue + dx * sensitivity * step).toFixed(decimals)
    updateDraft(raw)
    onLive(raw)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.scrubbed) {
      commit(draftRef.current ?? value)
    } else {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  const handlePointerCancel = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.scrubbed) revert()
  }

  const stepByKey = (direction: number, fine: boolean) => {
    const parsed = Number(draftRef.current ?? value)
    const current = Number.isFinite(parsed) ? parsed : 0
    const raw = clampValue(current + direction * step * (fine ? 10 : 1)).toFixed(decimals)
    updateDraft(raw)
    onLive(raw)
  }

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      type="text"
      name={name}
      autoComplete="off"
      inputMode="decimal"
      value={draft ?? value}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onChange={(event) => {
        const raw = event.currentTarget.value
        updateDraft(raw)
        onLive(raw)
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          if (draftRef.current !== null) commit(event.currentTarget.value)
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          if (draftRef.current !== null) revert()
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          stepByKey(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
        }
      }}
      onKeyUp={(event) => {
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && draftRef.current !== null) {
          commit(event.currentTarget.value)
        }
      }}
      onBlur={(event) => {
        if (draftRef.current !== null) commit(event.currentTarget.value)
      }}
      style={{ touchAction: 'none' }}
      className={cn('cursor-ew-resize select-none focus:cursor-text focus:select-auto', className)}
    />
  )
})

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
      const styles = getComputedStyle(el)
      const paddingX =
        (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0)
      const paddingY =
        (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
      const width = el.clientWidth - paddingX
      const wheelCount = isDock ? DOCK_WHEEL_DESCRIPTORS.length : WHEEL_DESCRIPTORS.length
      const maxSize = isDock ? MAX_DOCK_WHEEL_SIZE : MAX_WHEEL_SIZE
      const minSize = isDock ? MIN_DOCK_WHEEL_SIZE : MIN_WHEEL_SIZE
      const gridGap = isDock ? DOCK_WHEEL_GRID_GAP_PX : GRID_GAP_PX
      const slotWidth = (width - gridGap * (wheelCount - 1)) / wheelCount
      // In the dock the wheel column also stacks a header, value chips and a thumb
      // wheel — cap the wheel diameter by the available height so the column never
      // spills over the bottom parameter row.
      const slotHeight = isDock
        ? el.clientHeight - paddingY - DOCK_WHEEL_EXTRAS_PX
        : Number.POSITIVE_INFINITY
      setWheelSize(clamp(Math.floor(Math.min(slotWidth, slotHeight)), minSize, maxSize))
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(el)
    return () => observer.disconnect()
  }, [isDock])

  const updateNumberParam = (key: string, rawValue: string, mode: 'live' | 'commit') => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const next = Number(rawValue)
    if (!Number.isFinite(next)) return null
    const clamped = clampParamValue(param, next)
    if (mode === 'live') onParamLiveChange(effect.id, key, clamped)
    else onParamChange(effect.id, key, clamped)
    return clamped
  }

  const renderDockNumberControl = (key: string) => {
    const param = definition.params[key]
    if (!param || param.type !== 'number') return null
    const value = (gpuEffect.params[key] as number) ?? param.default
    const label = getEffectParamLabel(t, definition, key)

    return (
      <label
        key={key}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2"
      >
        <span className="min-w-0 truncate text-right text-[11px] text-muted-foreground">
          {label}
        </span>
        <span className="flex min-w-0 flex-col items-center">
          <DockNumberInput
            ariaLabel={label}
            name={`dock-${key}`}
            value={formatParamValue(value, param.step)}
            min={param.min}
            max={param.max}
            step={param.step}
            disabled={!effect.enabled}
            onLive={(raw) => updateNumberParam(key, raw, 'live')}
            onCommit={(raw) => updateNumberParam(key, raw, 'commit')}
            className="h-6 w-full rounded-[2px] border border-black/80 bg-black/75 px-1 text-center font-mono text-[11px] tabular-nums text-foreground shadow-inner focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 h-0.5 w-8 rounded-full bg-gradient-to-r',
              getDockParamAccent(key),
            )}
          />
        </span>
      </label>
    )
  }

  const renderDockWheelFields = (
    levelKey: string,
    hueKey: string,
    amountKey: string,
    wheelLabel: string,
  ) => {
    const levelParam = definition.params[levelKey]
    const hueParam = definition.params[hueKey]
    const amountParam = definition.params[amountKey]
    const levelValue = readNumberParam(definition, gpuEffect.params, levelKey)
    const hue = readNumberParam(definition, gpuEffect.params, hueKey)
    const amount = readNumberParam(definition, gpuEffect.params, amountKey)
    const fields = [
      { key: levelKey, param: levelParam, value: levelValue },
      { key: amountKey, param: amountParam, value: amount },
      { key: hueKey, param: hueParam, value: hue },
    ]

    return (
      <div className="w-full max-w-[11rem] px-1">
        <div className="grid grid-cols-3 gap-1">
          {fields.map(({ key, param, value }) => (
            <span key={key} className="flex min-w-0 flex-col items-center">
              <DockNumberInput
                ariaLabel={
                  key === levelKey
                    ? wheelLabel
                    : `${wheelLabel} ${getEffectParamLabel(t, definition, key)}`
                }
                name={`dock-${key}`}
                value={formatWheelChipValue(key, value, param?.step)}
                min={param?.min}
                max={param?.max}
                step={param?.step}
                disabled={!effect.enabled}
                onLive={(raw) => updateNumberParam(key, raw, 'live')}
                onCommit={(raw) => updateNumberParam(key, raw, 'commit')}
                className="h-5 w-full rounded-[2px] border border-black/80 bg-black/75 px-1 text-center font-mono text-[10px] leading-5 tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span
                aria-hidden="true"
                className={cn('mt-0.5 h-0.5 w-7 rounded-full', getDockFieldAccent(key))}
              />
            </span>
          ))}
        </div>
        <DockThumbWheel
          ariaLabel={`${wheelLabel} thumb wheel`}
          name={`dock-${levelKey}-thumb`}
          value={levelValue}
          min={levelParam?.min}
          max={levelParam?.max}
          step={levelParam?.step}
          disabled={!effect.enabled}
          onLive={(raw) => updateNumberParam(levelKey, raw, 'live')}
          onCommit={(raw) => updateNumberParam(levelKey, raw, 'commit')}
        />
      </div>
    )
  }

  const tonalRowClass = '[&>span]:w-[84px] [&>span]:min-w-[84px]'

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
          <div
            className="grid shrink-0 items-center gap-x-3 border-b border-border/70 px-4 py-1.5"
            style={{ gridTemplateColumns: `repeat(${DOCK_TOP_PARAMS.length}, minmax(0, 1fr))` }}
          >
            {DOCK_TOP_PARAMS.map(renderDockNumberControl)}
          </div>
          <div ref={wheelGridRef} className="min-h-0 flex-1 overflow-hidden px-6 py-3">
            <div className="grid min-h-full grid-cols-[repeat(4,minmax(3rem,1fr))] items-center gap-7">
              {DOCK_WHEEL_DESCRIPTORS.map((desc) => (
                <WheelControl
                  key={desc.labelKey}
                  label={t(desc.labelKey)}
                  hue={(gpuEffect.params[desc.hueKey] as number) ?? 0}
                  amount={(gpuEffect.params[desc.amountKey] as number) ?? 0}
                  size={wheelSize}
                  disabled={!effect.enabled}
                  dock
                  dockFields={renderDockWheelFields(
                    desc.levelKey,
                    desc.hueKey,
                    desc.amountKey,
                    t(desc.labelKey),
                  )}
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
          <div
            className="grid shrink-0 items-center gap-x-3 border-t border-border/70 px-4 py-1.5"
            style={{ gridTemplateColumns: `repeat(${DOCK_BOTTOM_PARAMS.length}, minmax(0, 1fr))` }}
          >
            {DOCK_BOTTOM_PARAMS.map(renderDockNumberControl)}
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
