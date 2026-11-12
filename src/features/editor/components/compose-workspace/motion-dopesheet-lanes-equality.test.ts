import { describe, expect, it } from 'vite-plus/test'
import {
  areMotionDopesheetLanesPropsEqual,
  type MotionDopesheetLanesProps,
} from './motion-dopesheet-lanes-equality'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'

const doNothing = () => {}

function createProps(): MotionDopesheetLanesProps {
  const item = {
    id: 'item-1',
    type: 'video',
    name: 'Clip',
  } as unknown as TimelineItem

  return {
    item,
    itemById: { [item.id]: item },
    itemKeyframes: undefined,
    properties: ['x', 'opacity'],
    compositionDurationInFrames: 300,
    fps: 30,
    canvas: { width: 1920, height: 1080 },
    propertyFilter: 'all',
    timeViewport: { startFrame: 10, endFrame: 110 },
    inlineCurveProperty: 'x',
    paneMode: 'lanes',
    disabled: false,
    onSelectItem: doNothing,
    onInlineCurveChange: doNothing,
    onScrub: doNothing,
    onTimeViewportChange: doNothing,
    onPropertyLinkPointerDown: doNothing,
    onRemovePropertyLink: doNothing,
    onSetPropertyExpression: doNothing,
    onRemovePropertyExpression: doNothing,
  }
}

type PropsChange = (props: MotionDopesheetLanesProps) => MotionDopesheetLanesProps

const comparedPropChanges: Array<[string, PropsChange]> = [
  ['item data', (props) => ({ ...props, item: { ...props.item, name: 'Renamed' } })],
  [
    'composition duration',
    (props) => ({
      ...props,
      compositionDurationInFrames: props.compositionDurationInFrames + 1,
    }),
  ],
  ['fps', (props) => ({ ...props, fps: props.fps + 1 })],
  [
    'canvas width',
    (props) => ({ ...props, canvas: { ...props.canvas, width: props.canvas.width + 1 } }),
  ],
  [
    'canvas height',
    (props) => ({ ...props, canvas: { ...props.canvas, height: props.canvas.height + 1 } }),
  ],
  ['property filter', (props) => ({ ...props, propertyFilter: 'keyframed' })],
  [
    'viewport start',
    (props) => ({
      ...props,
      timeViewport: { ...props.timeViewport, startFrame: props.timeViewport.startFrame + 1 },
    }),
  ],
  [
    'viewport end',
    (props) => ({
      ...props,
      timeViewport: { ...props.timeViewport, endFrame: props.timeViewport.endFrame + 1 },
    }),
  ],
  ['inline curve property', (props) => ({ ...props, inlineCurveProperty: 'opacity' })],
  ['pane mode', (props) => ({ ...props, paneMode: 'graph' })],
  ['disabled state', (props) => ({ ...props, disabled: true })],
  ['item lookup identity', (props) => ({ ...props, itemById: { ...props.itemById } })],
  ['keyframe identity', (props) => ({ ...props, itemKeyframes: {} as ItemKeyframes })],
  ['property count', (props) => ({ ...props, properties: [...props.properties, 'y'] })],
  ['property order', (props) => ({ ...props, properties: [...props.properties].reverse() })],
  [
    'property-link pointer callback',
    (props) => ({ ...props, onPropertyLinkPointerDown: () => {} }),
  ],
  ['remove-link callback', (props) => ({ ...props, onRemovePropertyLink: () => {} })],
  ['set-expression callback', (props) => ({ ...props, onSetPropertyExpression: () => {} })],
  ['remove-expression callback', (props) => ({ ...props, onRemovePropertyExpression: () => {} })],
]

describe('areMotionDopesheetLanesPropsEqual', () => {
  it('accepts equivalent value objects and property arrays', () => {
    const previous = createProps()
    const next = {
      ...previous,
      canvas: { ...previous.canvas },
      timeViewport: { ...previous.timeViewport },
      properties: [...previous.properties],
    }

    expect(areMotionDopesheetLanesPropsEqual(previous, next)).toBe(true)
  })

  it.each(comparedPropChanges)('rejects a changed %s', (_label, changeProps) => {
    const previous = createProps()

    expect(areMotionDopesheetLanesPropsEqual(previous, changeProps(previous))).toBe(false)
  })

  it('ignores text-motion data owned by the lightweight timeline lanes', () => {
    const previous = createProps()
    const next = {
      ...previous,
      item: {
        ...previous.item,
        textMotion: { durationInFrames: 24 },
      } as unknown as TimelineItem,
    }

    expect(areMotionDopesheetLanesPropsEqual(previous, next)).toBe(true)
  })

  it.each([
    ['item selection callback', 'onSelectItem'],
    ['inline-curve callback', 'onInlineCurveChange'],
    ['scrub callback', 'onScrub'],
    ['viewport callback', 'onTimeViewportChange'],
  ] as const)('ignores the stable parent-owned %s', (_label, callbackKey) => {
    const previous = createProps()
    const next = { ...previous, [callbackKey]: () => {} }

    expect(areMotionDopesheetLanesPropsEqual(previous, next)).toBe(true)
  })
})
