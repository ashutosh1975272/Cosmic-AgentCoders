import React from 'react'
import type { DashboardProject, ProjectSource } from '../../../../shared/dashboard-contract'
import { TeamsControlModal } from '../../components/dashboard/TeamsControlModal'
import { WhatsAppControlModal } from '../../components/dashboard/WhatsAppControlModal'
import { WorkspaceControlModal } from '../../components/dashboard/WorkspaceControlModal'

export interface PlatformControlModalProps {
  open: boolean
  project: DashboardProject
  source: ProjectSource | null
  onClose: () => void
  onSaved: () => void
}

export const PlatformControlModal: React.FC<PlatformControlModalProps> = ({
  open,
  project,
  source,
  onClose,
  onSaved
}) => {
  if (!open || !source) return null

  const platform =
    source.platform ||
    (source.id.includes('teams')
      ? 'teams'
      : source.id.includes('whatsapp')
        ? 'whatsapp'
        : 'slack')

  if (platform === 'teams') {
    return (
      <TeamsControlModal
        open={open}
        project={project}
        source={source}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  }

  if (platform === 'whatsapp') {
    return (
      <WhatsAppControlModal
        open={open}
        project={project}
        source={source}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  }

  return (
    <WorkspaceControlModal
      open={open}
      project={project}
      source={source}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}
