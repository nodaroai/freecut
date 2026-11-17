import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '../../deps/studio-contract'
import { useStudioStore } from '../../stores/studio-store'
import { watchActivity } from './activity-log'
import { StudioStatusBar, StudioTimecode } from './studio-bars'
import { StudioMonitorColumn, StudioScopesColumn, StudioSideSlot } from './studio-columns'
import { useStudioHosts } from './studio-hosts'
import { settleSplitOnce } from './studio-split'
import { StudioBrand, StudioCrewBar } from './studio-topbar'

/**
 * The studio layout (NODARO_STUDIO): our own panels portalled into the editor
 * the upstream code draws, and `data-nodaro-studio` on the page for the
 * stylesheet (nodaro-brand.css) to lay the rest out. Nothing until asked.
 */
export function StudioLayout() {
  const on = useStudioStore((s) => s.on)
  return on ? <StudioMounted /> : null
}

function StudioMounted() {
  const hosts = useStudioHosts()
  const sideOpen = useStudioStore((s) => s.sideOpen)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.nodaroStudio = ''
    // Media and properties share the work row; the timeline gets the full width.
    useEditorStore.setState({ mediaFullColumn: false, propertiesFullColumn: false })
    const stopActivity = watchActivity()
    // After the columns are in, so the split is measured with them.
    const frame = requestAnimationFrame(() => settleSplitOnce())
    return () => {
      delete root.dataset.nodaroStudio
      stopActivity()
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (sideOpen) root.dataset.nodaroSideOpen = ''
    else delete root.dataset.nodaroSideOpen
  }, [sideOpen])

  return (
    <>
      {createPortal(<StudioBrand />, hosts.brand)}
      {createPortal(<StudioCrewBar />, hosts.crew)}
      {createPortal(<StudioMonitorColumn />, hosts.monitor)}
      {createPortal(<StudioScopesColumn />, hosts.scopes)}
      {createPortal(<StudioSideSlot />, hosts.side)}
      {createPortal(<StudioTimecode />, hosts.timecode)}
      {createPortal(<StudioStatusBar />, hosts.status)}
    </>
  )
}
