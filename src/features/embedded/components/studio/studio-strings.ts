import { i18n } from '@/i18n'

/**
 * The studio layout's own words, kept here rather than in the editor's
 * dictionaries so the upstream locale files never change. English is the
 * fallback for a language not listed.
 */
const WORDS = {
  en: {
    source: 'Source',
    noSource: 'Nothing to show yet',
    activity: 'Agent activity',
    noActivity: 'The agents write here what they do.',
    scopes: 'Scopes',
    agentsLive: '{n} agents live',
    agentLive: '1 agent live',
    agentsAt: 'agents editing',
    clips: '{n} clips',
    agents: '{n} agents',
    ready: 'ready',
    working: 'working',
    close: 'Close the editor',
    newProject: 'Start over',
    crew: 'Agents in this project',
  },
  he: {
    source: 'מקור',
    noSource: 'אין עדיין מה להציג',
    activity: 'פעילות הסוכנים',
    noActivity: 'כאן הסוכנים כותבים מה הם עושים.',
    scopes: 'סקופים',
    agentsLive: '{n} סוכנים בעבודה',
    agentLive: 'סוכן אחד בעבודה',
    agentsAt: 'סוכנים עורכים',
    clips: '{n} קליפים',
    agents: '{n} סוכנים',
    ready: 'מוכן',
    working: 'בעבודה',
    close: 'סגירת העורך',
    newProject: 'להתחיל מחדש',
    crew: 'הסוכנים בפרויקט',
  },
  ja: {
    source: 'ソース',
    noSource: 'まだ表示するものがありません',
    activity: 'エージェントの動き',
    noActivity: 'エージェントがここに作業内容を書きます。',
    scopes: 'スコープ',
    agentsLive: '{n} 体のエージェントが作業中',
    agentLive: '1 体のエージェントが作業中',
    agentsAt: 'エージェントが編集中',
    clips: '{n} クリップ',
    agents: '{n} エージェント',
    ready: '準備完了',
    working: '作業中',
    close: 'エディターを閉じる',
    newProject: 'やり直す',
    crew: 'このプロジェクトのエージェント',
  },
  ko: {
    source: '소스',
    noSource: '아직 보여줄 것이 없습니다',
    activity: '에이전트 활동',
    noActivity: '에이전트가 하는 일을 여기에 적습니다.',
    scopes: '스코프',
    agentsLive: '에이전트 {n}명 작업 중',
    agentLive: '에이전트 1명 작업 중',
    agentsAt: '에이전트 편집 중',
    clips: '클립 {n}개',
    agents: '에이전트 {n}명',
    ready: '준비됨',
    working: '작업 중',
    close: '편집기 닫기',
    newProject: '처음부터 다시',
    crew: '이 프로젝트의 에이전트',
  },
  pt: {
    source: 'Origem',
    noSource: 'Nada para mostrar ainda',
    activity: 'Atividade dos agentes',
    noActivity: 'Os agentes escrevem aqui o que fazem.',
    scopes: 'Escopos',
    agentsLive: '{n} agentes trabalhando',
    agentLive: '1 agente trabalhando',
    agentsAt: 'agentes editando',
    clips: '{n} clipes',
    agents: '{n} agentes',
    ready: 'pronto',
    working: 'trabalhando',
    close: 'Fechar o editor',
    newProject: 'Recomeçar',
    crew: 'Agentes neste projeto',
  },
} as const

export type StudioWord = keyof (typeof WORDS)['en']

/** A studio word in the editor's language, with `{n}` filled in when given. */
export function studioWord(key: StudioWord, n?: number): string {
  const lang = (i18n.language || 'en').slice(0, 2) as keyof typeof WORDS
  const text: string = (WORDS[lang] ?? WORDS.en)[key]
  return n === undefined ? text : text.replace('{n}', String(n))
}
