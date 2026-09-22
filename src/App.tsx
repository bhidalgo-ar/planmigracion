import { useEffect, useState } from 'react'
import { AccountRail } from './components/AccountRail'
import { Timeline } from './components/Timeline'
import { DetailPanel } from './components/DetailPanel'
import { ConfigPanel } from './components/ConfigPanel'
import { Insights } from './components/Insights'
import { Equipo } from './components/Equipo'
import { Confidencial } from './components/Confidencial'
import { tieneBloqueConfidencial } from './confidencial'
import { PanelInsights } from './components/PanelInsights'
import { ModalEquipo } from './components/ModalEquipo'
import { ModalAgregarCuenta } from './components/ModalAgregarCuenta'
import { ResumenEjecutivo } from './components/ResumenEjecutivo'
import { ComoSeArmoModal } from './components/ComoSeArmo'
import { ResumenAnimado } from './resumen/ResumenAnimado'
import { segundoDelHash } from './resumen/guion'
import { useSimuladorStore } from './store'
import { useUIStore, type Vista } from './uiStore'
import logoUrl from './assets/logo-ha.png'

const CAMPOS_EDITABLES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// Sin emoji: con el plan de Willy, que trae el bloque confidencial, la barra lleva cinco
// pestañas y el emoji de cada una cuesta ~20 px de una fila que va justa. El 🔒 de
// Disponibilidad se queda porque no es decoración: dice que esa pestaña está protegida.
const TABS: { v: Vista; label: string }[] = [
  { v: 'timeline', label: 'Timeline' },
  { v: 'insights', label: 'Insights' },
  { v: 'equipo',   label: 'Equipo' },
  { v: 'resumen',  label: 'Resumen' },
]

export default function App() {
  const { vista, setVista, modal, resumenAbierto, timelineFull, comoSeArmoAbierto, mostrarRail } = useUIStore()
  // La pestaña confidencial existe solo si el plan cargado trae el bloque (nunca viene del seed).
  const hayConfidencial = useSimuladorStore(s => tieneBloqueConfidencial(s.config))
  // El panel de la cuenta es on-demand (spec 2026-09-22, §6.2): sin cuenta seleccionada no
  // ocupa los 336 px. Se abre al hacer clic en una cuenta del timeline y se cierra con su ×.
  const hayCuentaSeleccionada = useSimuladorStore(s => s.clienteSeleccionado !== null)
  const tabs = hayConfidencial ? [...TABS, { v: 'confidencial' as Vista, label: '🔒 Disponibilidad' }] : TABS
  useEffect(() => { if (vista === 'confidencial' && !hayConfidencial) setVista('timeline') }, [vista, hayConfidencial, setVista])
  // Un link con `#t=31` abre directo el video del resumen en ese segundo: si no
  // cambiáramos de pestaña, el link caería en el Timeline y no se vería nada.
  useEffect(() => {
    if (segundoDelHash(location.hash) !== null) setVista('resumen')
  }, [setVista])
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
      {/*
        UNA SOLA BARRA (22/09/2026, pedido de Willy). Antes eran dos franjas apiladas: el
        header de 56 px con la marca y las pestañas, y la barra de herramientas de 45 px.
        101 px de cromo antes de que empezara el contenido, en una pantalla donde lo que
        escasea es el alto.

        Para que todo entre en una fila de 1366 px hubo que pagar tres cosas, en este orden:
         - la marca va en una línea (el logo baja de 38 a 28 px y se saca el subtítulo);
         - las pestañas dejan de ser chips y pasan a texto con un subrayado en la activa,
           sin emoji: un chip gasta ~40 px de padding y borde por pestaña;
         - "Cómo se armó →" queda como "?", los chips de conflicto muestran el número sin la
           palabra, "Por cuenta / Por persona" queda en "Cuenta / Persona" y "⛶ Expandir" en
           el icono solo: todos con su title.
        La medida se tomó con el caso peor: el plan de Willy trae el bloque confidencial, así
        que la barra lleva CINCO pestañas. Con los rótulos completos ese caso desbordaba a
        1650 px en una ventana de 1366. El alto pasa de 101 px a 46.
      */}
      <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--line)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, height: 46, flexShrink: 0, position: 'relative', zIndex: 40 }}>
        <img src={logoUrl} alt="Hidalgo & Asociados" width={28} height={28} style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }} />
        {/* El único elemento de la barra que puede encogerse. Si la ventana es más angosta
            que 1366, o la tipografía del navegador mide más ancho que la de referencia, se
            recorta el nombre de la casa antes que un control: el logo sigue identificando la
            app y ningún botón se rompe ni desaparece. */}
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Hidalgo <span style={{ color: 'var(--gris)', fontWeight: 400, fontStyle: 'italic' }}>&amp;</span> Asociados
        </span>

        <div style={{ width: 1, height: 20, background: 'var(--line)', flexShrink: 0 }} />

        {/* Pestañas: texto con indicador abajo, no chips. */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {tabs.map(({ v, label }) => (
            <button key={v} onClick={() => setVista(v)} style={{
              padding: '4px 9px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 12.5, whiteSpace: 'nowrap',
              color: vista === v ? 'var(--celeste-dark)' : 'var(--t2)',
              fontWeight: vista === v ? 700 : 500,
              borderBottom: `2px solid ${vista === v ? 'var(--celeste)' : 'transparent'}`,
              transition: 'color 0.2s, border-color 0.2s',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--line)', flexShrink: 0 }} />

        {/* Los controles de vista y el menú "···", en la misma fila. */}
        <ConfigPanel />

        {/* Toggle tema */}
        <button onClick={toggleTheme} title={darkMode ? 'Modo claro' : 'Modo oscuro'}
          style={{ width: 26, height: 26, borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
          {darkMode ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--lienzo)' }}>
        {vista === 'timeline' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
              {mostrarRail && !timelineFull && <AccountRail />}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}><Timeline /></div>
              {hayCuentaSeleccionada && !timelineFull && <DetailPanel />}
            </div>
            <PanelInsights />
          </div>
        ) : vista === 'equipo' ? (
          <Equipo />
        ) : vista === 'resumen' ? (
          <ResumenAnimado />
        ) : vista === 'confidencial' && hayConfidencial ? (
          <Confidencial />
        ) : (
          <Insights />
        )}
      </div>

      {/* Modales / overlays */}
      {modal === 'equipo' && <ModalEquipo />}
      {modal === 'cuenta' && <ModalAgregarCuenta />}
      {resumenAbierto && <ResumenEjecutivo />}
      {comoSeArmoAbierto && <ComoSeArmoModal />}
    </div>
  )
}
