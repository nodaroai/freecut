import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useProjectStore } from '../deps/projects'

interface ProjectNameEditorProps {
  project: { id: string; name: string }
}

/**
 * Inline-editable project title for the toolbar: double-click to rename.
 * The editor route loads `project` once via the route loader, so the live
 * name is read from the project store — renames reflect immediately without
 * reloading the route.
 */
export const ProjectNameEditor = memo(function ProjectNameEditor({
  project,
}: ProjectNameEditorProps) {
  const { t } = useTranslation()
  const liveName = useProjectStore((state) =>
    state.currentProject?.id === project.id ? state.currentProject.name : null,
  )
  const displayName = liveName ?? project.name ?? t('common.untitledProject')
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draft !== null) inputRef.current?.select()
  }, [draft])

  const commit = async () => {
    const next = (draft ?? '').trim()
    setDraft(null)
    if (!next || next === displayName) return
    try {
      await useProjectStore.getState().updateProject(project.id, { name: next })
    } catch {
      toast.error(t('toolbar.renameFailed'))
    }
  }

  if (draft === null) {
    return (
      <h1
        className="cursor-text truncate text-sm font-medium leading-none"
        data-tooltip={t('toolbar.renameProject')}
        data-tooltip-side="bottom"
        onDoubleClick={() => setDraft(displayName)}
      >
        {displayName}
      </h1>
    )
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={draft}
      maxLength={100}
      aria-label={t('toolbar.renameProjectAria')}
      className="h-5 w-44 rounded border border-border bg-transparent px-1 text-sm font-medium leading-none outline-none focus:border-primary"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(null)
        }
      }}
    />
  )
})
