import type { CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore, type Densidad, type ZoomLevel } from '../uiStore'

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
    config, updateConfigFecha, violaciones, resetToSeed, exportarJSON, importarJSON,
    clearAsignaciones, asignaciones, historial, undo, autoPlanificarPendientes,
    recalcularDuraciones,
  } = useSimuladorStore()
  const {
    mostrarCarga, mostrarDep, mostrarConflictos, toggleCarga, toggleDep, toggleConflictos,
    setResumen, timelineFull, toggleTimelineFull, zoom, setZoom, irHoy, modoMovimiento, setModoMovimiento, densidad, setDensidad,
  } = useUIStore()

  const transicion = config.fechas_clave.transicion_susana_toyota
  const rojos = violaciones.filter(v => v.severidad === 'rojo').length
  const ambar = violaciones.filter(v => v.severidad === 'ambar').length

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
    const blob = new Blob([exportarJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'plan-migracion.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ background: 'var(--white)', borderBottom: '1px solid var(--line)', padding: '9px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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

      {/* Nivel de zoom */}
      <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>
        {ZOOM_OPTS.map(z => (
          <button key={z.value} onClick={() => setZoom(z.value)}
            style={{ padding: '4px 11px', border: 'none', background: zoom === z.value ? 'var(--celeste)' : 'var(--white)', color: zoom === z.value ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {z.label}
          </button>
        ))}
      </div>

      {/* Ir al día de hoy */}
      <button onClick={irHoy} style={{ ...pillBtn, display: 'flex', alignItems: 'center', gap: 5, borderColor: 'var(--celeste-border)', color: 'var(--celeste-dark)' }} title="Centrar el timeline en el día de hoy">
        📍 Hoy
      </button>

      {/* Alto de las filas de persona */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>Filas</span>
        <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>
          {DENSIDAD_OPTS.map(d => (
            <button key={d.value} onClick={() => setDensidad(d.value)}
              style={{ padding: '4px 11px', border: 'none', background: densidad === d.value ? 'var(--celeste)' : 'var(--white)', color: densidad === d.value ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              title={`Alto de fila ${d.value}`}>{d.label}</button>
          ))}
        </div>
      </div>

      {/* Modo de movimiento al arrastrar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>Al mover</span>
        <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9999, overflow: 'hidden' }}>
          <button onClick={() => setModoMovimiento('flexible')}
            style={{ padding: '4px 11px', border: 'none', background: modoMovimiento === 'flexible' ? 'var(--celeste)' : 'var(--white)', color: modoMovimiento === 'flexible' ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            title="Arrastrar mueve solo la tarea (Shift = esta fase y las siguientes)">⚡ Flexible</button>
          <button onClick={() => setModoMovimiento('estricto')}
            style={{ padding: '4px 11px', border: 'none', background: modoMovimiento === 'estricto' ? 'var(--celeste)' : 'var(--white)', color: modoMovimiento === 'estricto' ? '#fff' : 'var(--t2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            title="Arrastrar mueve esta fase y las siguientes de la cuenta; las anteriores no se tocan (Shift = solo esta tarea)">🔗 Estricto</button>
        </div>
      </div>

      {/* Toggles de visualización */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={toggleConflictos} style={{ ...pillBtn, ...(mostrarConflictos ? activePill : {}) }} title={mostrarConflictos ? 'Ocultar el resaltado de conflictos (barras rojas y anillos) del timeline' : 'Mostrar el resaltado de conflictos en el timeline'}>
          {mostrarConflictos ? 'Conflictos' : 'Conflictos (oculto)'}
        </button>
        <button onClick={toggleCarga} style={{ ...pillBtn, ...(mostrarCarga ? activePill : {}) }} title="Pintar carga semanal en las celdas">Carga semanal</button>
        <button onClick={toggleDep} style={{ ...pillBtn, ...(mostrarDep ? activePill : {}) }} title="Mostrar flechas de dependencia de la cuenta seleccionada">Dependencias</button>
        <button onClick={toggleTimelineFull} style={{ ...pillBtn, ...(timelineFull ? activePill : {}) }} title={timelineFull ? 'Volver a mostrar los paneles laterales' : 'Expandir timeline al 100% (oculta cuentas y detalle)'}>
          {timelineFull ? '⛶ Restaurar paneles' : '⛶ Expandir timeline'}
        </button>
      </div>

      {/* Conteos */}
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        {rojos > 0 && <span style={chip('var(--error-bg)', 'var(--error-tx)', 'var(--error-bd)')}>⚠ {rojos} conflicto{rojos !== 1 ? 's' : ''}</span>}
        {ambar > 0 && <span style={chip('var(--warn-bg)', 'var(--warn-tx)', 'var(--warn-bd)')}>⚡ {ambar} aviso{ambar !== 1 ? 's' : ''}</span>}
        {rojos === 0 && ambar === 0 && <span style={chip('var(--ok-bg)', 'var(--ok-tx)', 'var(--ok-bd)')}>✓ Sin conflictos</span>}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={undo} disabled={!historial.length}
          style={{ ...actionBtn, opacity: historial.length ? 1 : 0.45, cursor: historial.length ? 'pointer' : 'default' }}
          title="Deshacer el último cambio (Ctrl+Z)">↩ Deshacer</button>
        <button onClick={handleAutoPlanificar} style={actionBtn} title="Encadena Relevamiento → Configuración → Pruebas para las cuentas sin tareas (o con alguna fase faltante), buscando un hueco libre para no generar sobreasignación. No toca TASA/Toyota: esa se planifica con la perilla 'Inicio Toyota'.">🪄 Planificar pendientes</button>
        <button onClick={handleRecalcular} disabled={!asignaciones.length}
          style={{ ...actionBtn, opacity: asignaciones.length ? 1 : 0.45, cursor: asignaciones.length ? 'pointer' : 'default' }}
          title="Recalcula la duración de cada fase con sus horas de esfuerzo y la disponibilidad de la persona asignada, y reencadena Configuración y Pruebas. No reasigna personas ni reordena cuentas.">⏱ Recalcular duraciones</button>
        <button onClick={() => setResumen(true)} style={{ ...actionBtn, background: 'var(--celeste)', color: '#fff', border: 'none' }} title="Resumen ejecutivo imprimible">📄 Resumen</button>
        <button onClick={handleExport} style={actionBtn} title="Exportar plan como JSON">↓ Exportar</button>
        <button onClick={handleImport} style={actionBtn} title="Importar plan desde JSON">↑ Importar</button>
        <button
          onClick={() => { if (asignaciones.length && confirm(`¿Eliminar las ${asignaciones.length} asignaciones? Las cuentas y el equipo se mantienen, pero quedan sin planificar.`)) clearAsignaciones() }}
          disabled={!asignaciones.length}
          style={{ ...actionBtn, color: 'var(--error-tx)', borderColor: 'var(--error-bd)', opacity: asignaciones.length ? 1 : 0.45, cursor: asignaciones.length ? 'pointer' : 'default' }}
          title="Eliminar todas las asignaciones del plan">🗑 Vaciar asignaciones</button>
        <button onClick={() => { if (confirm('¿Resetear al plan original del board?')) resetToSeed() }} style={{ ...actionBtn, color: 'var(--error-tx)', borderColor: 'var(--error-bd)' }} title="Volver al seed original">↺ Reset</button>
      </div>
    </div>
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
