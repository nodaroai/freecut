// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { wordHighlightCues } from './caption-words'

const CAPTION = { text: 'Here is how I plan', start: 1, end: 3 }
const WORDS = [
  { text: 'Here', start: 1.2, end: 1.5 },
  { text: 'is', start: 1.5, end: 1.7 },
  { text: 'how', start: 1.8, end: 2.1 },
  { text: 'I', start: 2.2, end: 2.3 },
  { text: 'plan', start: 2.4, end: 2.9 },
]

describe('wordHighlightCues', () => {
  it('lights up each word in turn and keeps the caption on screen between words', () => {
    const cues = wordHighlightCues(CAPTION, WORDS, '#FFD400')

    expect(cues).toEqual([
      { text: 'Here is how I plan', start: 1, end: 1.2 },
      { text: '<font color="#FFD400">Here</font> is how I plan', start: 1.2, end: 1.5 },
      { text: 'Here <font color="#FFD400">is</font> how I plan', start: 1.5, end: 1.8 },
      { text: 'Here is <font color="#FFD400">how</font> I plan', start: 1.8, end: 2.2 },
      { text: 'Here is how <font color="#FFD400">I</font> plan', start: 2.2, end: 2.4 },
      { text: 'Here is how I <font color="#FFD400">plan</font>', start: 2.4, end: 3 },
    ])
  })

  it('finds a repeated word at its own place and keeps the caption text as written', () => {
    const cues = wordHighlightCues(
      { text: 'No, no. NO!', start: 0, end: 1 },
      [
        { text: 'no', start: 0, end: 0.3 },
        { text: 'no', start: 0.3, end: 0.6 },
        { text: 'no', start: 0.6, end: 1 },
      ],
      '#fff',
    )

    expect(cues.map((cue) => cue.text)).toEqual([
      '<font color="#fff">No</font>, no. NO!',
      'No, <font color="#fff">no</font>. NO!',
      'No, no. <font color="#fff">NO</font>!',
    ])
  })

  it('shows a word the text does not contain without a highlight, and clamps words to the caption', () => {
    const cues = wordHighlightCues(
      { text: 'Hello there', start: 2, end: 3 },
      [
        { text: 'Hello', start: 1.8, end: 2.4 },
        { text: 'friend', start: 2.4, end: 3.5 },
      ],
      '#f00',
    )

    expect(cues).toEqual([
      { text: '<font color="#f00">Hello</font> there', start: 2, end: 2.4 },
      { text: 'Hello there', start: 2.4, end: 3 },
    ])
  })
})
