import React from 'react'
import { AppIcon } from '../../components/AppIcon'
import type { PlatformId } from '../../../../shared/platforms/platform-contract'

export interface PlatformThinBarProps {
  platform: PlatformId
  workspaceName: string
  subtitle?: string
  isConnected?: boolean
  channelCount?: number
  onOpenControl: () => void
  onReauthenticate: () => void
  reauthTitle?: string
}

export const PlatformThinBar: React.FC<PlatformThinBarProps> = ({
  platform,
  workspaceName,
  subtitle,
  isConnected = true,
  channelCount = 0,
  onOpenControl,
  onReauthenticate,
  reauthTitle
}) => {
  const iconAppId = platform === 'teams' ? 'teams' : platform === 'whatsapp' ? 'whatsapp' : 'slack'
  const defaultReauthTitle =
    platform === 'teams'
      ? 'Re-open Microsoft login flow'
      : platform === 'whatsapp'
        ? 'Refresh or reconnect WhatsApp session'
        : 'Re-open Slack login flow'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 14px',
        background: '#0d1117',
        borderBottom: '1px solid #21262d',
        fontSize: '12px',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AppIcon appId={iconAppId} size={14} />
        <span style={{ fontWeight: 600, color: '#e6edf3' }}>{workspaceName}</span>
        {subtitle && (
          <span style={{ color: '#8b949e', fontSize: '11px' }}>
            &middot; {subtitle}
          </span>
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: isConnected ? '#3fb950' : '#8b949e',
            fontSize: '11px',
            marginLeft: '4px'
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isConnected ? '#3fb950' : '#8b949e'
            }}
          />
          {isConnected ? 'Connected' : 'Offline'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onOpenControl}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#1f6feb',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 10px',
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
          title={`Configure ${workspaceName} permissions and scraping`}
        >
          <span>⚙️ Control</span>
          {channelCount > 0 && (
            <span
              style={{
                background: 'rgba(255,255,255,0.25)',
                borderRadius: '8px',
                padding: '0 5px',
                fontSize: '10px'
              }}
            >
              {channelCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onReauthenticate}
          style={{
            background: 'transparent',
            color: '#8b949e',
            border: '1px solid #30363d',
            borderRadius: '4px',
            fontSize: '11px',
            padding: '3px 9px',
            cursor: 'pointer'
          }}
          title={reauthTitle || defaultReauthTitle}
        >
          Re-authenticate
        </button>
      </div>
    </div>
  )
}
