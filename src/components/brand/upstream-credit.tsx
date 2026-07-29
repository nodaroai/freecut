import { BRAND_NAME } from '@/shared/branding'

/**
 * MIT attribution for the upstream project this deployment is built on.
 * Lives outside the i18n tree on purpose: the runtime rebrand rewrites
 * "FreeCut" to the deployment brand everywhere else, but the license credit
 * must keep naming the original project.
 */
const UPSTREAM_NAME = 'FreeCut'
const UPSTREAM_REPO_URL = 'https://github.com/walterlow/freecut'
const UPSTREAM_COPYRIGHT = 'MIT License © 2025 FreeCut'

export function UpstreamCredit({ year }: { year: number }) {
  return (
    <span>
      © {year} {BRAND_NAME} · Built on{' '}
      <a
        href={UPSTREAM_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {UPSTREAM_NAME}
      </a>{' '}
      ({UPSTREAM_COPYRIGHT})
    </span>
  )
}
