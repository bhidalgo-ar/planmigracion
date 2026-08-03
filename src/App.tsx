import { useEffect, useState } from 'react'
import { AccountRail } from './components/AccountRail'
import { Timeline } from './components/Timeline'
import { DetailPanel } from './components/DetailPanel'
import { ConfigPanel } from './components/ConfigPanel'
import { Insights } from './components/Insights'
import { PanelInsights } from './components/PanelInsights'
import { ModalEquipo } from './components/ModalEquipo'
import { ModalAgregarCuenta } from './components/ModalAgregarCuenta'
import { ResumenEjecutivo } from './components/ResumenEjecutivo'
import { useSimuladorStore } from './store'
import { useUIStore, type Vista } from './uiStore'
import logoUrl from './assets/logo-ha.png'

const CAMPOS_EDITABLES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

const TABS: { v: Vista; label: string }[] = [
  { v: 'timeline', label: '📅 Timeline' },
  { v: 'insights', label: '📊 Insights' },
]

export default function App() {
  const { vista, setVista, modal, resumenAbierto, timelineFull } = useUIStore()
  const [darkMode, setDarkMode] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')

  function toggleTheme() {
    const next = darkMode ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setDarkMode(!darkMode)
  }

  // Ctrl+Z / Cmd+Z deshace el último cambio del plan. Si el foco está en un campo
  // editable, se deja pasar: que el navegador maneje el undo nativo de ese texto.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const esDeshacer = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
      if (!esDeshacer) return
      const target = e.target as HTMLElement | null
      if (target && CAMPOS_EDITABLES.has(target.tagName)) return
      e.preventDefault()
      useSimuladorStore.getState().undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'var(--font)', color: 'var(--t1)' }}>
      {/* Header */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--line)', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 20, height: 56, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logoUrl} alt="Hidalgo & Asociados" width={38} height={38} style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              Hidalgo <span style={{ color: 'var(--gris)', fontWeight: 400, fontStyle: 'italic' }}>&amp;</span> Asociados
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--celeste-deeper)' }}>
              Simulador de Migración
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 20 }}>
          {TABS.map(({ v, label }) => (
            <button key={v} onClick={() => setVista(v)} style={{
              padding: '6px 16px', borderRadius: 9999,
              border: vista === v ? 'none' : '1px solid var(--line)',
              background: vista === v ? 'var(--celeste)' : 'transparent',
              color: vista === v ? '#fff' : 'var(--t2)', cursor: 'pointer', fontSize: 13,
              fontWeight: vista === v ? 700 : 500, transition: 'background 0.22s, color 0.22s, border-color 0.22s',
            }}>{label}</button>
          ))}
        </div>

        {/* Toggle tema */}
        <button onClick={toggleTheme} title={darkMode ? 'Modo claro' : 'Modo oscuro'}
          style={{ marginLeft: 'auto', width: 36, height: 36, borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {darkMode ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* Barra de configuración (siempre visible) */}
      <ConfigPanel />

      {/* Contenido */}
      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--lienzo)' }}>
        {vista === 'timeline' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
              {!timelineFull && <AccountRail />}
              <div style={{ flex: 1, overflow: 'hidden' }}><Timeline /></div>
              {!timelineFull && <DetailPanel />}
            </div>
            <PanelInsights />
          </div>
        ) : (
          <Insights />
        )}
      </div>

      {/* Modales / overlays */}
      {modal === 'equipo' && <ModalEquipo />}
      {modal === 'cuenta' && <ModalAgregarCuenta />}
      {resumenAbierto && <ResumenEjecutivo />}
    </div>
  )
}
