import { useState } from 'react'
import { DEFAULT_PORT, type Settings, type ThemeMode } from '../../../shared/types'
import { BRAND } from '../../../shared/brand'
import { Computer, FolderIcon, Gear, Key, Refresh, X } from '../icons'
import { api } from '../theme'
import { Confirm, CopyButton, Overlay, Segmented, Switch, useToast } from './ui'

type Section = 'general' | 'appearance' | 'router'

const SWATCHES = BRAND.swatches

export default function SettingsDialog({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const toast = useToast()
  const [section, setSection] = useState<Section>('general')
  const [port, setPort] = useState(String(settings.port))
  const [confirmRegen, setConfirmRegen] = useState(false)

  const update = (p: Partial<Settings>): void => {
    void api.updateSettings(p).catch((e) => toast((e as Error).message, true))
  }

  const applyPort = (): void => {
    const n = Number(port)
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      toast('Port must be a number between 1024 and 65535', true)
      setPort(String(settings.port))
      return
    }
    if (n !== settings.port) {
      update({ port: n })
      toast(`Router moved to port ${n}. Connected apps were updated.`)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="dialog">
        <div className="dialog-nav">
          <h2>Settings</h2>
          <button className={`nav-item${section === 'general' ? ' active' : ''}`} onClick={() => setSection('general')}>
            <Gear size={16} /> General
          </button>
          <button className={`nav-item${section === 'appearance' ? ' active' : ''}`} onClick={() => setSection('appearance')}>
            <Computer size={16} /> Appearance
          </button>
          <button className={`nav-item${section === 'router' ? ' active' : ''}`} onClick={() => setSection('router')}>
            <Key size={16} /> Router & security
          </button>
        </div>
        <div className="dialog-body">
          <div className="dialog-head">
            <h3>{section === 'general' ? 'General' : section === 'appearance' ? 'Appearance' : 'Router & security'}</h3>
            <span className="spacer" />
            <button className="icon-btn" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          </div>
          <div className="dialog-scroll">
            {section === 'general' && (
              <>
                <div className="srow">
                  <div className="l">
                    <div className="t">Launch at login</div>
                    <div className="h">Start {BRAND.name} quietly in the tray when you sign in to Windows.</div>
                  </div>
                  <div className="c">
                    <Switch checked={settings.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Start in the tray</div>
                    <div className="h">Don't open the window at startup.</div>
                  </div>
                  <div className="c">
                    <Switch checked={settings.startHidden} onChange={(v) => update({ startHidden: v })} />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Keep running when closed</div>
                    <div className="h">Closing the window hides it to the tray so your apps stay connected.</div>
                  </div>
                  <div className="c">
                    <Switch checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Config folder</div>
                    <div className="h">Where {BRAND.name} keeps its settings. Secrets inside are encrypted.</div>
                  </div>
                  <div className="c">
                    <button className="btn sm" onClick={() => void api.openConfigDir()}>
                      <FolderIcon size={14} /> Open
                    </button>
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Quit {BRAND.name}</div>
                    <div className="h">Stops every server. Connected apps lose their tools until {BRAND.name} runs again.</div>
                  </div>
                  <div className="c">
                    <button className="btn sm danger" onClick={() => void api.quit()}>
                      Quit
                    </button>
                  </div>
                </div>
              </>
            )}

            {section === 'appearance' && (
              <>
                <div className="srow">
                  <div className="l">
                    <div className="t">Theme</div>
                  </div>
                  <div className="c">
                    <Segmented<ThemeMode>
                      value={settings.theme.mode}
                      onChange={(mode) => update({ theme: { ...settings.theme, mode } })}
                      options={[
                        { value: 'system', label: 'System' },
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' }
                      ]}
                    />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Accent</div>
                    <div className="h">Used for highlights, switches and the {BRAND.name} mark.</div>
                  </div>
                  <div className="c" style={{ width: 'auto' }}>
                    <div className="swatches">
                      {SWATCHES.map((c) => (
                        <button
                          key={c}
                          className={`swatch${settings.theme.accent.toLowerCase() === c ? ' on' : ''}`}
                          style={{ background: c }}
                          title={c}
                          onClick={() => update({ theme: { ...settings.theme, accent: c } })}
                        />
                      ))}
                    </div>
                    <input type="color" value={settings.theme.accent} onChange={(e) => update({ theme: { ...settings.theme, accent: e.target.value } })} />
                  </div>
                </div>
              </>
            )}

            {section === 'router' && (
              <>
                <div className="srow">
                  <div className="l">
                    <div className="t">Port</div>
                    <div className="h">{BRAND.name} listens on 127.0.0.1 only. Default {DEFAULT_PORT}. Connected apps are rewritten when this changes.</div>
                  </div>
                  <div className="c">
                    <input
                      className="input mono"
                      style={{ width: 110 }}
                      value={port}
                      onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                      onBlur={applyPort}
                      onKeyDown={(e) => e.key === 'Enter' && applyPort()}
                    />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Require access token</div>
                    <div className="h">Stops other programs on this computer from using your servers. Leave on unless an app can't send headers.</div>
                  </div>
                  <div className="c">
                    <Switch checked={settings.requireToken} onChange={(v) => update({ requireToken: v })} />
                  </div>
                </div>
                <div className="srow">
                  <div className="l">
                    <div className="t">Access token</div>
                    <div className="h">Regenerating it updates every connected app automatically.</div>
                  </div>
                  <div className="c">
                    <span className="mono faint" style={{ fontSize: 12 }}>
                      {settings.token.slice(0, 8)}…
                    </span>
                    <CopyButton text={settings.token} label="Token copied" />
                    <button className="btn sm" onClick={() => setConfirmRegen(true)}>
                      <Refresh size={14} /> Regenerate
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {confirmRegen && (
        <Confirm
          title="Regenerate token?"
          body={`Apps ${BRAND.name} connected for you are updated automatically. Anything you set up by hand will need the new token.`}
          action="Regenerate"
          onConfirm={() => {
            void api.regenToken().then(() => toast('New token issued'))
          }}
          onClose={() => setConfirmRegen(false)}
        />
      )}
    </Overlay>
  )
}
