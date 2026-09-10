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

const PRESETS: { label: string; fecha: string }[] = [
  { label: 'Ago 26', fecha: '2026-08-03' },
  { label: 'Oct 26', fecha: '2026-10-05' },
]

export function ConfigPanel() {
  const {
    config, updateConfigFecha, violaciones, resetToSeed, exportarJSON, exportOmiteConfidencial, importarJSON,
    clearAsignaciones, asignaciones, historial, undo, autoPlanificarPendientes,
    recalcularDuraciones,
  } = useSimuladorStore()
  const {
    mostrarCarga, mostrarDep, mostrarConflictos, toggleCarga, toggleDep, toggleConflictos,
    setResumen, timelineFull, toggleTimelineFull, zoom, setZoom, irHoy, modoMovimiento, setModoMovimiento, densidad, setDensidad,
  } = useUIStore()
  const [masAbierto, setMasAbierto] = useState(false)
  const masRef = useRef<HTMLDivElement>(null)

  const transicion = config.fechas_clave.transicion_susana_toyota
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
    const { creadas } = autoPlanificarPendientes()
    if (creadas === 0) alert('No hay fases pendientes: todas las cuentas ya tienen Relevamiento, Configuración y Pruebas.')
  }

  function handleRecalcular() {
    if (!asignaciones.length) return
    if (!confirm('¿Recalcular la duración de todas las fases con las horas de cada fase y la disponibilidad de cada persona?\n\nNo cambia quién hace qué ni las fechas de inicio: solo cuánto dura cada fase. Se puede deshacer.')) return
    const { recalculadas, cambiadas, intactas, conflictos } = recalcularDuraciones()
    const estiradas = cambiadas.filter(c => c.diasDespues > c.diasAntes)
    const L = [`${recalculadas} fases recalculadas, ${cambiadas.length} cambiaron de duración.`]
    if (estiradas.length) {
      const peor = estiradas.reduce((m, c) => (c.diasDespues - c.diasAntes > m.diasDespues - m.diasAntes ? c : m), estiradas[0])
      L.push(`${estiradas.length} se estiraron (la que más: ${peor.id}, ${peor.diasAntes} → ${peor.diasDespues} días).`)
    }
    if (intactas) L.push(`${intactas} sin tocar (bloqueos y cuentas especiales).`)
    L.push('', 'Las fechas de inicio no se movieron.')
    L.push(conflictos
      ? `Quedan ${conflictos} conflicto${conflictos !== 1 ? 's' : ''} en rojo por resolver: acomodá las barras en el timeline.`
      : 'El plan cierra sin conflictos.')
    alert(L.join('\n'))
  }

  function handleImport() {
    setMasAbierto(false)
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try { importarJSON(ev.target?.result as string) } catch { alert('Archivo JSON inválido') }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  function handleExport() {
    setMasAbierto(false)
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
      {/* Fila 1 · Cómo ver el timeline */}
      <div style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottom: '1px solid var(--line-soft)' }}>
        {/* Nivel de zoom */}
        <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>
          {ZOOM_OPTS.map(z => (
            <button key={z.value} onClick={() => setZoom(z.value)}
              style={{ padding: '4px 11px', border: 'none', background: zoom === z.value ? 'var(--celeste)' : 'var(--white)', color: zoom === z.value ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {z.label}
            </button>
          ))}
        </div>

        <button onClick={irHoy} style={{ ...pillBtn, display: 'flex', alignItems: 'center', gap: 5, borderColor: 'var(--celeste-border)', color: 'var(--celeste-dark)' }} title="Centrar el timeline en el día de hoy">
          📍 Hoy
        </button>

        <Divider />

        {/* Alto de las filas de persona */}
        <Grupo label="Filas">
          {DENSIDAD_OPTS.map(d => (
            <button key={d.value} onClick={() => setDensidad(d.value)}
              style={{ padding: '4px 11px', border: 'none', background: densidad === d.value ? 'var(--celeste)' : 'var(--white)', color: densidad === d.value ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              title={`Alto de fila ${d.value}`}>{d.label}</button>
          ))}
        </Grupo>

        {/* Modo de movimiento al arrastrar */}
        <Grupo label="Al mover">
          <button onClick={() => setModoMovimiento('flexible')}
            style={{ padding: '4px 11px', border: 'none', background: modoMovimiento === 'flexible' ? 'var(--celeste)' : 'var(--white)', color: modoMovimiento === 'flexible' ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            title="Arrastrar mueve solo la tarea (Shift = esta fase y las siguientes)">⚡ Flexible</button>
          <button onClick={() => setModoMovimiento('estricto')}
            style={{ padding: '4px 11px', border: 'none', background: modoMovimiento === 'estricto' ? 'var(--celeste)' : 'var(--white)', color: modoMovimiento === 'estricto' ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            title="Arrastrar mueve esta fase y las siguientes de la cuenta; las anteriores no se tocan (Shift = solo esta tarea)">🔗 Estricto</button>
        </Grupo>

        <Divider />

        {/* Qué personas se ven y en qué orden */}
        <MenuPersonas />

        <Divider />

        {/* Toggles de visualización */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={toggleConflictos} style={{ ...pillBtn, ...(mostrarConflictos ? activePill : {}) }} title={mostrarConflictos ? 'Ocultar el resaltado de conflictos (barras rojas y anillos) del timeline' : 'Mostrar el resaltado de conflictos en el timeline'}>
            Conflictos
          </button>
          <button onClick={toggleCarga} style={{ ...pillBtn, ...(mostrarCarga ? activePill : {}) }} title="Pintar carga semanal en las celdas">Carga semanal</button>
          <button onClick={toggleDep} style={{ ...pillBtn, ...(mostrarDep ? activePill : {}) }} title="Mostrar flechas de dependencia de la cuenta seleccionada">Dependencias</button>
        </div>

        <button onClick={toggleTimelineFull} style={{ ...pillBtn, ...(timelineFull ? activePill : {}), marginLeft: 'auto' }} title={timelineFull ? 'Volver a mostrar los paneles laterales' : 'Expandir timeline al 100% (oculta cuentas y detalle)'}>
          {timelineFull ? '⛶ Restaurar paneles' : '⛶ Expandir timeline'}
        </button>
      </div>

      {/* Fila 2 · El plan: perilla, acciones y estado */}
      <div style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Perilla + presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>Inicio Toyota</label>
          <input type="date" value={transicion ?? ''} onChange={e => updateConfigFecha('transicion_susana_toyota', e.target.value || null)}
            style={{ padding: '5px 8px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 13, fontWeight: 500, background: 'var(--white)', color: 'var(--ink)' }} />
          {PRESETS.map(p => (
            <button key={p.fecha} onClick={() => updateConfigFecha('transicion_susana_toyota', p.fecha)}
              style={{ ...pillBtn, ...(transicion === p.fecha ? activePill : {}) }} title={`Poner transición en ${p.fecha}`}>{p.label}</button>
          ))}
          {transicion && (
            <button onClick={() => updateConfigFecha('transicion_susana_toyota', null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 16, padding: 0 }} title="Limpiar fecha">×</button>
          )}
        </div>

        <Divider />

        {/* Acciones frecuentes */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={undo} disabled={!historial.length}
            style={{ ...actionBtn, opacity: historial.length ? 1 : 0.45, cursor: historial.length ? 'pointer' : 'default' }}
            title="Deshacer el último cambio (Ctrl+Z)">↩ Deshacer</button>
          <button onClick={handleAutoPlanificar} style={actionBtn} title="Encadena Relevamiento → Configuración → Pruebas para las cuentas sin tareas (o con alguna fase faltante), buscando un hueco libre para no generar sobreasignación. No toca TASA/Toyota: esa se planifica con la perilla 'Inicio Toyota'.">🪄 Planificar pendientes</button>
          <button onClick={handleRecalcular} disabled={!asignaciones.length}
            style={{ ...actionBtn, opacity: asignaciones.length ? 1 : 0.45, cursor: asignaciones.length ? 'pointer' : 'default' }}
            title="Recalcula la duración de cada fase con sus horas de esfuerzo y la disponibilidad de la persona asignada, y reencadena Configuración y Pruebas. No reasigna personas ni reordena cuentas.">⏱ Recalcular duraciones</button>
          <button onClick={() => setResumen(true)} style={{ ...actionBtn, background: 'var(--celeste)', color: '#fff', border: 'none' }} title="Resumen ejecutivo imprimible">📄 Resumen</button>

          {/* Menú "Más": acciones poco frecuentes o destructivas, fuera del flujo habitual. */}
          <div ref={masRef} style={{ position: 'relative' }}>
            <button onClick={() => setMasAbierto(v => !v)} style={{ ...actionBtn, ...(masAbierto ? activePill : {}) }} title="Más acciones: exportar, importar, vaciar o resetear el plan">
              ⋯ Más
            </button>
            {masAbierto && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: 210,
                background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--sh)',
                padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <MenuItem onClick={handleExport} title="Exportar plan como JSON">↓ Exportar</MenuItem>
                <MenuItem onClick={handleImport} title="Importar plan desde JSON">↑ Importar</MenuItem>
                <MenuDivider />
                <MenuItem
                  onClick={() => { setMasAbierto(false); if (asignaciones.length && confirm(`¿Eliminar las ${asignaciones.length} asignaciones? Las cuentas y el equipo se mantienen, pero quedan sin planificar.`)) clearAsignaciones() }}
                  disabled={!asignaciones.length} tono="error" title="Eliminar todas las asignaciones del plan">
                  🗑 Vaciar asignaciones
                </MenuItem>
                <MenuItem
                  onClick={() => { setMasAbierto(false); if (confirm('¿Resetear al plan original del board?')) resetToSeed() }}
                  tono="error" title="Volver al seed original">
                  ↺ Reset
                </MenuItem>
              </div>
            )}
          </div>
        </div>

        {/* Estado del plan */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {rojos > 0 && <span style={chip('var(--error-bg)', 'var(--error-tx)', 'var(--error-bd)')}>⚠ {rojos} conflicto{rojos !== 1 ? 's' : ''}</span>}
          {ambar > 0 && <span style={chip('var(--warn-bg)', 'var(--warn-tx)', 'var(--warn-bd)')}>⚡ {ambar} aviso{ambar !== 1 ? 's' : ''}</span>}
          {rojos === 0 && ambar === 0 && <span style={chip('var(--ok-bg)', 'var(--ok-tx)', 'var(--ok-bd)')}>✓ Sin conflictos</span>}
        </div>
      </div>
    </div>
  )
}

/** Agrupa controles relacionados con un rótulo chico + un segmented control. */
function Grupo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

/** Separador vertical fino entre grupos de controles, para que cada cluster se lea aparte. */
function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--line)', flexShrink: 0 }} />
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--line-soft)', margin: '4px 2px' }} />
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
  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t1)',
}
function chip(bg: string, tx: string, bd: string): CSSProperties {
  return { background: bg, color: tx, border: `1px solid ${bd}`, borderRadius: 9999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }
}
