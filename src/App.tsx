import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
import { MesaSalidas } from './components/MesaSalidas'
import { HoyProximo } from './components/HoyProximo'
import { ModoReunion } from './components/ModoReunion'
import { Comparar } from './components/Comparar'
import { BarraEscenario } from './components/BarraEscenario'
import { PanelEscenario } from './components/PanelEscenario'
import { segundoDelHash } from './resumen/guion'
import { useSimuladorStore } from './store'
import { useUIStore, type Vista } from './uiStore'
import logoUrl from './assets/logo-ha.png'

const CAMPOS_EDITABLES = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// Rediseño 23/10/2026: cinco vistas en la barra, cada una contesta una pregunta (qué sale cuándo,
// qué pasa hoy, dónde se trabaja moviendo cuentas, cómo se cuenta en una reunión, qué cambió en
// el escenario). Las vistas para otro público (gerencia, payroll, el video y la confidencial)
// pasan a "Más": la fila única va justa y no entran nueve pestañas.
const TABS: { v: Vista; label: string }[] = [
  { v: 'salidas',  label: 'Salidas' },
  { v: 'hoy',      label: 'Hoy' },
  { v: 'timeline', label: 'Timeline' },
  { v: 'reunion',  label: 'Reunión' },
  { v: 'comparar', label: 'Comparar' },
]
const MAS: { v: Vista; label: string }[] = [
  { v: 'insights', label: 'Insights' },
  { v: 'equipo',   label: 'Equipo' },
  { v: 'resumen',  label: 'Resumen (video)' },
]

export default function App() {
  const { vista, setVista, modal, resumenAbierto, timelineFull, comoSeArmoAbierto, mostrarRail, modoFilas, detalleCuenta } = useUIStore()
  // La pestaña confidencial existe solo si el plan cargado trae el bloque (nunca viene del seed).
  const hayConfidencial = useSimuladorStore(s => tieneBloqueConfidencial(s.config))
  // El panel de la cuenta es on-demand (spec 2026-09-22, §6.2): sin cuenta seleccionada no
  // ocupa los 336 px. Se abre al hacer clic en una cuenta del timeline y se cierra con su ×.
  const hayCuentaSeleccionada = useSimuladorStore(s => s.clienteSeleccionado !== null)
  const mas = hayConfidencial ? [...MAS, { v: 'confidencial' as Vista, label: '🔒 Disponibilidad' }] : MAS
  const hayEscenario = useSimuladorStore(s => s.escenarioBase !== null)
  const panelEscenario = useUIStore(s => s.panelEscenario)
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
        <div style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          {TABS.map(({ v, label }) => (
            <button key={v} onClick={() => setVista(v)} style={pestana(vista === v)}
              title={v === 'comparar' ? (hayEscenario ? 'El escenario contra el plan del que partió' : 'Probar un escenario y compararlo con el plan') : undefined}>
              {label}{v === 'comparar' && hayEscenario && <span aria-label="escenario abierto" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--warn)', marginLeft: 5, verticalAlign: 'middle' }} />}
            </button>
          ))}
          <MenuMas items={mas} vista={vista} onElegir={setVista} />
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

      {hayEscenario && <BarraEscenario />}

      {/* Contenido */}
      <div style={{ flex: 1, overflow: 'hidden', background: 'var(--lienzo)' }}>
        {vista === 'salidas' ? (
          <MesaSalidas />
        ) : vista === 'hoy' ? (
          <HoyProximo />
        ) : vista === 'reunion' ? (
          <ModoReunion />
        ) : vista === 'comparar' ? (
          <Comparar />
        ) : vista === 'timeline' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {panelEscenario && !timelineFull && <PanelEscenario />}
            <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
              {mostrarRail && !timelineFull && <AccountRail />}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}><Timeline /></div>
              {/* Vista D: en el Timeline por cuenta, elegir una cuenta abre la tira "Mover a" en su
                  fila; el panel lateral queda para "Detalle" (renombrar, tareas, qué cambió). */}
              {hayCuentaSeleccionada && !timelineFull && (modoFilas === 'persona' || detalleCuenta) && <DetailPanel />}
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

function pestana(activa: boolean): CSSProperties {
  return {
    padding: '4px 9px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 12.5, whiteSpace: 'nowrap',
    color: activa ? 'var(--celeste-dark)' : 'var(--t2)',
    fontWeight: activa ? 700 : 500,
    borderBottom: `2px solid ${activa ? 'var(--celeste)' : 'transparent'}`,
    transition: 'color 0.2s, border-color 0.2s',
  }
}

/** "Más ▾": las vistas para otro público. Si la activa es una de ellas, el botón lleva su nombre. */
function MenuMas({ items, vista, onElegir }: { items: { v: Vista; label: string }[]; vista: Vista; onElegir: (v: Vista) => void }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])
  const activa = items.find(i => i.v === vista)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(a => !a)} style={pestana(!!activa)} aria-expanded={abierto} title="Insights, Equipo, el video del resumen y Disponibilidad">
        {activa ? activa.label : 'Más'} <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {abierto && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: 190, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--sh)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map(i => (
            <button key={i.v} onClick={() => { onElegir(i.v); setAbierto(false) }}
              style={{ textAlign: 'left', padding: '8px 10px', border: 'none', borderRadius: 8, background: vista === i.v ? 'var(--celeste-dim)' : 'transparent', color: vista === i.v ? 'var(--celeste-dark)' : 'var(--t1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
