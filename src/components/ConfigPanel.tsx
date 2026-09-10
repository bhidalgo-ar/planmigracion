import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore, type Densidad, type ZoomLevel } from '../uiStore'
import { MenuPersonas } from './MenuPersonas'

const DENSIDAD_OPTS: { value: Densidad; label: string }[] = [
  { value: 'compacta', label: 'S' },
  { value: 'comoda',   label: 'M' },
  { value: 'amplia',   label: 'L' },
]

const ZOOM_OPTS: { value: ZoomLevel; label: string }[] = [
  { value: 'dias',       label: 'Días' },
  { value: 'semanas',    label: 'Semanas' },
  { value: 'meses',      label: 'Meses' },
  { value: 'trimestres', label: 'Trimestres' },
]

/**
 * Barra de la app, en UNA fila a 1280 px. A la vista queda lo que se usa en una reunión:
 * zoom, Hoy, Personas, Deshacer, Resumen, Importar/Exportar y el chip de estado. Todo lo
 * demás (alto de fila, modo de arrastre, capas del timeline, planificador, vaciar, reset)
 * vive en "Más". La perilla "Inicio Toyota" y el botón "Recalcular duraciones" se sacaron:
 * TASA no está en el plan y el recálculo pisaba las dedicaciones del JSON.
 */
export function ConfigPanel() {
  const {
    violaciones, resetToSeed, exportarJSON, exportOmiteConfidencial, importarJSON,
    clearAsignaciones, asignaciones, historial, undo, autoPlanificarPendientes, replanificarDesdeElCorte,
  } = useSimuladorStore()
  const {
    mostrarCarga, mostrarDep, mostrarConflictos, toggleCarga, toggleDep, toggleConflictos,
    setResumen, timelineFull, toggleTimelineFull, zoom, setZoom, irHoy, modoMovimiento, setModoMovimiento, densidad, setDensidad,
    ocultarPersonasSinCarga, modoFilas, setModoFilas,
  } = useUIStore()
  const [masAbierto, setMasAbierto] = useState(false)
  const masRef = useRef<HTMLDivElement>(null)

  const rojos = violaciones.filter(v => v.severidad === 'rojo').length
  const ambar = violaciones.filter(v => v.severidad === 'ambar').length

  // Cierra el menú "Más" al hacer click afuera.
  useEffect(() => {
    if (!masAbierto) return
    function onClick(e: MouseEvent) {
      if (masRef.current && !masRef.current.contains(e.target as Node)) setMasAbierto(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [masAbierto])

  function handleAutoPlanificar() {
    setMasAbierto(false)
    const { creadas } = autoPlanificarPendientes()
    if (creadas === 0) alert('No hay fases pendientes: todas las cuentas ya tienen Relevamiento, Configuración y Pruebas.')
  }

  function handleReplanificar() {
    setMasAbierto(false)
    const r = replanificarDesdeElCorte()
    const partes = [`${r.replanificadas} cuenta${r.replanificadas !== 1 ? 's' : ''} rearmada${r.replanificadas !== 1 ? 's' : ''} desde su corte.`]
    if (r.sinCorte.length) partes.push(`Sin corte de novedades (no se tocaron): ${r.sinCorte.join(', ')}.`)
    if (r.sinLugar.length) partes.push(`Sin lugar antes del corte (no se tocaron): ${r.sinLugar.join(', ')}.`)
    alert(partes.join('\n'))
  }

  function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const r = importarJSON(ev.target?.result as string)
        const L: string[] = []
        if (!r.ok) {
          L.push(`No se importó "${file.name}". El archivo tiene problemas de forma:`, '')
          for (const e of r.errores) L.push(`• ${e}`)
          L.push('', 'El plan que estaba cargado sigue igual.')
        } else {
          // Se guarda el nombre del archivo para poder decir de qué plan es el video
          // del resumen ejecutivo ("Plan v3 · 10 de septiembre de 2026").
          useUIStore.getState().setNombrePlan(file.name.replace(/\.json$/i, ''))
          L.push(`Importado "${file.name}": ${r.resumen.personas} personas, ${r.resumen.proyectos} cuentas, ${r.resumen.asignaciones} fases.`)
          if (r.resumen.sinAsignar) L.push(`${r.resumen.sinAsignar} fase${r.resumen.sinAsignar !== 1 ? 's' : ''} quedan en la fila "Sin asignar".`)
          if (r.avisos.length) { L.push('', 'Para mirar:'); for (const a of r.avisos.slice(0, 10)) L.push(`• ${a}`); if (r.avisos.length > 10) L.push(`• … y ${r.avisos.length - 10} más`) }
          // Las filas sin carga arrancan ocultas (se vuelven a ver con "Personas → Ver todas").
          const { personas, asignaciones: asig } = useSimuladorStore.getState()
          ocultarPersonasSinCarga(personas.filter(p => !asig.some(a => a.persona_id === p.id && !a.es_bloqueo)).map(p => p.id))
        }
        alert(L.join('\n'))
      }
      reader.readAsText(file)
    }
    input.click()
  }

  function handleExport() {
    if (exportOmiteConfidencial()) {
      alert('El plan se exporta SIN el bloque confidencial (equipo_confidencial): la pestaña "Disponibilidad del equipo" está bloqueada en esta sesión. Desbloqueala antes de exportar si lo necesitás en el archivo.')
    }
    const blob = new Blob([exportarJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'plan-migracion.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--line)', position: 'relative', zIndex: 40 }}>
      <div style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
        {/* Nivel de zoom */}
        <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden', flexShrink: 0 }}>
          {ZOOM_OPTS.map(z => (
            <button key={z.value} onClick={() => setZoom(z.value)}
              style={{ padding: '4px 11px', border: 'none', background: zoom === z.value ? 'var(--celeste)' : 'var(--white)', color: zoom === z.value ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {z.label}
            </button>
          ))}
        </div>

        {/* Qué es cada fila: una cuenta con sus fases y la carga del equipo debajo, o una persona (vista original) */}
        <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden', flexShrink: 0 }}
          title="Por cuenta: una fila por cuenta con sus fases y la carga semanal del equipo debajo. Por persona: una fila por persona.">
          {([['cuenta', 'Por cuenta'], ['persona', 'Por persona']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setModoFilas(v)}
              style={{ padding: '4px 11px', border: 'none', background: modoFilas === v ? 'var(--celeste)' : 'var(--white)', color: modoFilas === v ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>

        <button onClick={irHoy} style={{ ...pillBtn, display: 'flex', alignItems: 'center', gap: 5, borderColor: 'var(--celeste-border)', color: 'var(--celeste-dark)', flexShrink: 0 }} title="Centrar el timeline en el día de hoy">
          📍 Hoy
        </button>

        <MenuPersonas />

        <Divider />

        <button onClick={undo} disabled={!historial.length}
          style={{ ...actionBtn, opacity: historial.length ? 1 : 0.45, cursor: historial.length ? 'pointer' : 'default' }}
          title="Deshacer el último cambio (Ctrl+Z)">↩ Deshacer</button>
        <button onClick={() => setResumen(true)} style={{ ...actionBtn, background: 'var(--celeste)', color: '#fff', border: 'none' }} title="Resumen ejecutivo imprimible">📄 Resumen</button>
        <button onClick={handleImport} style={actionBtn} title="Importar plan desde JSON (valida el archivo antes de cargarlo)">↑ Importar</button>
        <button onClick={handleExport} style={actionBtn} title="Exportar plan como JSON">↓ Exportar</button>

        {/* Menú "Más": lo que no se toca en una reunión. */}
        <div ref={masRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setMasAbierto(v => !v)} style={{ ...actionBtn, ...(masAbierto ? activePill : {}) }} title="Más opciones: vista del timeline, planificador, vaciar o resetear el plan">
            ⋯ Más
          </button>
          {masAbierto && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: 250,
              background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--sh)',
              padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <MenuTitulo>Timeline</MenuTitulo>
              <MenuFila label="Alto de fila">
                <Segmentos>
                  {DENSIDAD_OPTS.map(d => (
                    <Seg key={d.value} activo={densidad === d.value} onClick={() => setDensidad(d.value)} title={`Alto de fila ${d.value}`}>{d.label}</Seg>
                  ))}
                </Segmentos>
              </MenuFila>
              <MenuFila label="Al mover">
                <Segmentos>
                  <Seg activo={modoMovimiento === 'flexible'} onClick={() => setModoMovimiento('flexible')} title="Arrastrar mueve solo la tarea (Shift = esta fase y las siguientes)">⚡ Flexible</Seg>
                  <Seg activo={modoMovimiento === 'estricto'} onClick={() => setModoMovimiento('estricto')} title="Arrastrar mueve esta fase y las siguientes de la cuenta (Shift = solo esta tarea)">🔗 Estricto</Seg>
                </Segmentos>
              </MenuFila>
              <MenuCheck checked={mostrarConflictos} onClick={toggleConflictos}>Resaltar conflictos</MenuCheck>
              <MenuCheck checked={mostrarCarga} onClick={toggleCarga}>Carga semanal</MenuCheck>
              <MenuCheck checked={mostrarDep} onClick={toggleDep}>Dependencias</MenuCheck>
              <MenuCheck checked={timelineFull} onClick={toggleTimelineFull}>Expandir timeline</MenuCheck>
              <MenuDivider />
              <MenuTitulo>Plan</MenuTitulo>
              <MenuItem onClick={handleAutoPlanificar} title="Encadena Relevamiento → Configuración → Pruebas para las cuentas sin fases, buscando hueco libre.">🪄 Planificar pendientes</MenuItem>
              <MenuItem onClick={handleReplanificar} title="Rearma las fechas de cada cuenta hacia atrás desde el corte de novedades de su mes de salida: margen mínimo, blackout, lunes y feriados. No cambia quién hace qué ni cuánto dura cada fase.">🧭 Replanificar desde el corte</MenuItem>
              <MenuItem
                onClick={() => { setMasAbierto(false); if (asignaciones.length && confirm(`¿Eliminar las ${asignaciones.length} asignaciones? Las cuentas y el equipo se mantienen, pero quedan sin planificar.`)) clearAsignaciones() }}
                disabled={!asignaciones.length} tono="error" title="Eliminar todas las asignaciones del plan">
                🗑 Vaciar asignaciones
              </MenuItem>
              <MenuItem
                onClick={() => { setMasAbierto(false); if (confirm('¿Resetear al plan original del seed?')) resetToSeed() }}
                tono="error" title="Volver al seed original">
                ↺ Reset
              </MenuItem>
            </div>
          )}
        </div>

        {/* Estado del plan */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          {rojos > 0 && <span style={chip('var(--error-bg)', 'var(--error-tx)', 'var(--error-bd)')}>⚠ {rojos} conflicto{rojos !== 1 ? 's' : ''}</span>}
          {ambar > 0 && <span style={chip('var(--warn-bg)', 'var(--warn-tx)', 'var(--warn-bd)')}>⚡ {ambar} aviso{ambar !== 1 ? 's' : ''}</span>}
          {rojos === 0 && ambar === 0 && <span style={chip('var(--ok-bg)', 'var(--ok-tx)', 'var(--ok-bd)')}>✓ Sin conflictos</span>}
        </div>
      </div>
    </div>
  )
}

/** Separador vertical fino entre grupos de controles. */
function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--line)', flexShrink: 0 }} />
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 2px' }} />
}

function MenuTitulo({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)', padding: '4px 10px 0' }}>{children}</div>
}

function MenuFila({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '4px 10px' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>{label}</span>
      {children}
    </div>
  )
}

function Segmentos({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>{children}</div>
}

function Seg({ activo, onClick, title, children }: { activo: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      style={{ padding: '3px 10px', border: 'none', background: activo ? 'var(--celeste)' : 'var(--white)', color: activo ? '#fff' : 'var(--t2)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

function MenuCheck({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', width: '100%',
      padding: '6px 10px', border: 'none', borderRadius: 8, background: 'transparent',
      color: 'var(--t1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--paper)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${checked ? 'var(--celeste)' : 'var(--line)'}`, background: checked ? 'var(--celeste)' : 'transparent', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {checked ? '✓' : ''}
      </span>
      {children}
    </button>
  )
}

function MenuItem({ children, onClick, disabled, tono, title }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; tono?: 'error'; title?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: 'flex', alignItems: 'center', textAlign: 'left', width: '100%',
      padding: '7px 10px', border: 'none', borderRadius: 8, background: 'transparent',
      color: disabled ? 'var(--t3)' : tono === 'error' ? 'var(--error-tx)' : 'var(--t1)',
      fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--paper)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      {children}
    </button>
  )
}

const pillBtn: CSSProperties = {
  padding: '4px 11px', borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--line)', borderRadius: 9999, background: 'var(--white)',
  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t2)',
}
const activePill: CSSProperties = { background: 'var(--celeste)', color: '#fff', borderColor: 'var(--celeste)' }
const actionBtn: CSSProperties = {
  padding: '5px 14px', borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--line)', borderRadius: 9999, background: 'var(--white)',
  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', flexShrink: 0,
}
function chip(bg: string, tx: string, bd: string): CSSProperties {
  return { background: bg, color: tx, border: `1px solid ${bd}`, borderRadius: 9999, padding: '4px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }
}
