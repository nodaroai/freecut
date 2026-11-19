import { i18n } from '@/i18n'
import { postToParent } from '../../services/studio-message'
import { useStudioStore } from '../../stores/studio-store'

/**
 * Effects · GFX, under the media: what the agents add to an edit, each in its
 * lane's colour. A tap opens Edit with AI, where it is asked for and priced.
 * The words are kept here so the upstream locale files never change.
 */
const WORDS = {
  en: {
    title: 'Effects · GFX',
    chapter: 'Chapter title',
    keywords: 'Key words',
    window: 'Picture window',
    zoom: 'Punch zoom',
    look: 'Warm look',
    music: 'Music bed',
    hint: 'Ask Edit with AI for it',
  },
  he: {
    title: 'אפקטים · גרפיקה',
    chapter: 'כותרת פרק',
    keywords: 'מילות מפתח',
    window: 'חלון תמונה',
    zoom: 'זום חד',
    look: 'מראה חם',
    music: 'מוזיקת רקע',
    hint: 'לבקש מ-Edit with AI',
  },
  ja: {
    title: 'エフェクト · GFX',
    chapter: 'チャプタータイトル',
    keywords: 'キーワード',
    window: 'ピクチャーウィンドウ',
    zoom: 'パンチズーム',
    look: '暖かいルック',
    music: 'BGM',
    hint: 'Edit with AI に頼む',
  },
  ko: {
    title: '효과 · GFX',
    chapter: '챕터 제목',
    keywords: '키워드',
    window: '사진 창',
    zoom: '펀치 줌',
    look: '따뜻한 룩',
    music: '배경 음악',
    hint: 'Edit with AI에 요청',
  },
  pt: {
    title: 'Efeitos · GFX',
    chapter: 'Título de capítulo',
    keywords: 'Palavras-chave',
    window: 'Janela de imagem',
    zoom: 'Zoom rápido',
    look: 'Visual quente',
    music: 'Música de fundo',
    hint: 'Pedir ao Edit with AI',
  },
} as const

type EffectWord = Exclude<keyof (typeof WORDS)['en'], 'title' | 'hint'>

function word(key: keyof (typeof WORDS)['en']): string {
  const lang = (i18n.language || 'en').slice(0, 2) as keyof typeof WORDS
  return (WORDS[lang] ?? WORDS.en)[key]
}

/** Each effect and the lane it lands on, for its colour. */
const EFFECTS: ReadonlyArray<{ readonly word: EffectWord; readonly lane: string }> = [
  { word: 'chapter', lane: 'text' },
  { word: 'keywords', lane: 'subtitle' },
  { word: 'window', lane: 'image' },
  { word: 'zoom', lane: 'video' },
  { word: 'look', lane: 'adjustment' },
  { word: 'music', lane: 'audio' },
]

export function StudioEffects() {
  const sideOpen = useStudioStore((s) => s.sideOpen)
  const sideLabel = useStudioStore((s) => s.sideLabel)
  const open = () => {
    if (!sideOpen) postToParent('FREECUT_STUDIO_ACTION', { action: 'toggle-side' })
  }
  return (
    <section className="nodaro-studio-panel nodaro-studio-effects">
      <header className="nodaro-studio-panel-head">
        <span>{word('title')}</span>
      </header>
      <div className="nodaro-studio-effects-grid">
        {EFFECTS.map((effect) => (
          <button
            key={effect.word}
            type="button"
            data-lane={effect.lane}
            className="nodaro-studio-effect"
            title={word('hint')}
            disabled={!sideLabel}
            onClick={open}
          >
            <span aria-hidden="true" className="nodaro-studio-effect-dot" />
            {word(effect.word)}
          </button>
        ))}
      </div>
    </section>
  )
}
