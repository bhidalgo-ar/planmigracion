import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import type { Asignacion, Persona, TipoFase, Violacion } from '../types'
import { tierDe, TIER_LABEL } from '../insightsEquipo'
import { TIPO_COLOR, TIPO_LABEL, ORDEN_FASES } from '../theme/fases'
import { formatFechaCorta } from '../utils/dates'

export function DetailPanel() {
  const config = useSimuladorStore(s => s.config)
  const { proyectos, asignaciones, personas, violaciones, clienteSeleccionado, updateAsignacion, addFase, shiftAccount, renameProyecto, removeProyecto } =
    useSimuladorStore()

  const proyecto = proyectos.find(p => p.id === clienteSeleccionado) ?? null

  // edición del nombre de la cuenta
  const [editando, setEditando] = useState(false)
  const [nombreDraft, setNombreDraft] = useState('')
  useEffect(() => { setEditando(false) }, [clienteSeleccionado])

  function empezarRename() {
    if (!proyecto) return
    setNombreDraft(proyecto.nombre)
    setEditando(true)
  }
  function confirmarRename() {
    if (proyecto) renameProyecto(proyecto.id, nombreDraft)
    setEditando(false)
  }
  function handleRemove() {
    if (!proyecto) return
    const fases = asignaciones.filter(a => a.proyecto_id === proyecto.id).length
    const detalle = fases ? ` y sus ${fases} fase${fases !== 1 ? 's' : ''}` : ''
    if (confirm(`¿Eliminar la cuenta "${proyecto.nombre}"${detalle}? Esta acción no se puede deshacer.`)) removeProyecto(proyecto.id)
  }

  const violsPorAsig = useMemo(() => {
    const m = new Map<string, Violacion[]>()
    for (const v of violaciones) m.set(v.asignacion_id, [...(m.get(v.asignacion_id) ?? []), v])
    return m
  }, [violaciones])

  const fasesPorTipo = useMemo(() => {
    if (!proyecto) return []
    const fases = asignaciones.filter(a => a.proyecto_id === proyecto.id && !a.es_bloqueo)
    return ORDEN_FASES.map(tipo => ({ tipo, asignacion: fases.find(f => f.tipo === tipo) ?? null }))
  }, [proyecto, asignaciones])

  return (
    <div style={{ width: 336, flexShrink: 0, borderLeft: '1px solid var(--line)', background: 'var(--paper)', overflowY: 'auto', height: '100%', padding: 18 }}>
      {!proyecto ? (
        <div style={{ color: 'var(--t3)', textAlign: 'center', marginTop: 60, fontSize: 14, lineHeight: 1.6, padding: '0 12px' }}>
          Seleccioná una cuenta del panel izquierdo para ver y editar sus fases.
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--t3)' }}>
            En el timeline: arrastrá una barra para moverla · vertical reasigna persona · borde derecho estira. Arrastrá el fondo (o usá el botón del medio del mouse) para desplazarte. Con el toggle "Al mover" elegís si arrastrar mueve solo la tarea (Flexible) o también las fases siguientes de la cuenta (Estricto, nunca las anteriores); Shift invierte el modo puntualmente.
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {editando ? (
                <input
                  value={nombreDraft}
                  onChange={e => setNombreDraft(e.target.value)}
                  onBlur={confirmarRename}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarRename(); if (e.key === 'Escape') setEditando(false) }}
                  autoFocus
                  maxLength={40}
                  style={{ flex: 1, fontSize: 18, fontWeight: 700, color: 'var(--ink)', padding: '4px 8px', border: '1.5px solid var(--celeste)', borderRadius: 8, background: 'var(--white)' }}
                />
              ) : (
                <>
                  <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>{proyecto.nombre}</h2>
                  <button onClick={empezarRename} title="Renombrar cuenta" style={iconBtn}>✏️</button>
                  <button onClick={handleRemove} title="Eliminar cuenta" style={{ ...iconBtn, color: 'var(--error-tx)' }}>🗑</button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {proyecto.especial && <span style={pill('var(--tasa)')}>Especial · Toyota</span>}
              {proyecto.quick_win && <span style={pill('var(--ok)')}>Quick-win</span>}
              {proyecto.entidades > 1 && <span style={pill('var(--celeste)')}>{proyecto.entidades} entidades</span>}
              {(() => { const t = tierDe(proyecto.id, config); return t
                ? <span style={pill(t === 'grande' ? 'var(--fase-relev)' : t === 'chica' ? 'var(--ok)' : 'var(--celeste-dark)')}>Cuenta {TIER_LABEL[t]}</span>
                : <span style={pill('var(--gris)')}>tier sin definir</span> })()}
            </div>
          </div>

          {/* Mover cuenta entera */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 10px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t2)', flex: 1 }}>Mover cuenta entera</span>
            <button onClick={() => shiftAccount(proyecto.id, -1)} style={moverBtn} title="Adelantar 1 semana">◀ 1 sem</button>
            <button onClick={() => shiftAccount(proyecto.id, 1)} style={moverBtn} title="Atrasar 1 semana">1 sem ▶</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fasesPorTipo.map(({ tipo, asignacion }) => (
              <FaseCard
                key={tipo}
                tipo={tipo}
                asignacion={asignacion}
                personas={personas}
                violaciones={asignacion ? (violsPorAsig.get(asignacion.id) ?? []) : []}
                onUpdate={patch => asignacion && updateAsignacion(asignacion.id, patch)}
                onCreate={personaId => proyecto && addFase(proyecto.id, tipo, personaId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface FaseCardProps {
  tipo: TipoFase
  asignacion: Asignacion | null
  personas: Persona[]
  violaciones: Violacion[]
  onUpdate: (patch: Partial<Asignacion>) => void
  onCreate: (personaId: string) => void
}

function FaseCard({ tipo, asignacion, personas, violaciones, onUpdate, onCreate }: FaseCardProps) {
  const color = TIPO_COLOR[tipo]
  const hasRojo = violaciones.some(v => v.severidad === 'rojo')
  const hasAmbar = violaciones.some(v => v.severidad === 'ambar')
  const borderColor = hasRojo ? 'var(--error)' : hasAmbar ? 'var(--warn)' : 'var(--line)'

  return (
    <div style={{ border: `1.5px solid ${borderColor}`, borderRadius: 10, overflow: 'hidden', background: 'var(--white)', boxShadow: 'var(--sh-sm)' }}>
      <div style={{ background: color, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{TIPO_LABEL[tipo]}</span>
        {(hasRojo || hasAmbar) && (
          <span style={{ background: hasRojo ? 'var(--error)' : 'var(--warn)', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 10.5, fontWeight: 600, marginLeft: 'auto' }}>
            {hasRojo ? '⚠ Conflicto' : '⚡ Atención'}
          </span>
        )}
      </div>

      {asignacion ? (
        <div style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Campo label="Asignado a">
              <select value={asignacion.persona_id} onChange={e => onUpdate({ persona_id: e.target.value })} style={input}>
                {personas.map(p => <option key={p.id} value={p.id}>{p.alias}</option>)}
              </select>
            </Campo>
            <Campo label="Duración">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => onUpdate({ duracion_dias: Math.max(1, asignacion.duracion_dias - 1) })} style={stepBtn}>−</button>
                <span style={{ minWidth: 54, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{asignacion.duracion_dias} días</span>
                <button onClick={() => onUpdate({ duracion_dias: asignacion.duracion_dias + 1 })} style={stepBtn}>+</button>
              </div>
            </Campo>
            <Campo label="Inicio">
              <input type="date" value={asignacion.inicio} onChange={e => e.target.value && onUpdate({ inicio: e.target.value })} style={input} />
            </Campo>
            <Campo label="Fin (calculado)">
              <div style={{ ...input, background: 'var(--paper)', color: 'var(--t2)', border: '1.5px solid var(--line-soft)' }}>
                {formatFechaCorta(asignacion.fin)}
              </div>
            </Campo>
            <Campo label="Dedicación">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => onUpdate({ dedicacion_pct: Math.max(0.05, Math.round((asignacion.dedicacion_pct - 0.05) * 100) / 100) })} style={stepBtn}>−</button>
                <span style={{ minWidth: 54, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{Math.round(asignacion.dedicacion_pct * 100)}%</span>
                <button onClick={() => onUpdate({ dedicacion_pct: Math.min(2, Math.round((asignacion.dedicacion_pct + 0.05) * 100) / 100) })} style={stepBtn}>+</button>
              </div>
            </Campo>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.4 }}>
            La dedicación es la fracción de la jornada diaria (7 h, Gaby 4 h) que esta persona le pone a la fase. La carga del mes suma las horas de todas sus fases y se compara con su capacidad.
          </div>
          {violaciones.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {violaciones.map((v, i) => (
                <div key={i} style={{
                  fontSize: 11.5, padding: '6px 9px',
                  background: v.severidad === 'rojo' ? 'var(--error-bg)' : 'var(--warn-bg)',
                  borderLeft: `3px solid ${v.severidad === 'rojo' ? 'var(--error)' : 'var(--warn)'}`,
                  borderRadius: '0 6px 6px 0', color: v.severidad === 'rojo' ? 'var(--error-tx)' : 'var(--warn-tx)',
                }}>{v.mensaje}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 14 }}>
          <Campo label="¿Quién la hace?">
            <select
              value=""
              onChange={e => { if (e.target.value) onCreate(e.target.value) }}
              style={input}
            >
              <option value="" disabled>Elegí una persona…</option>
              {personas.map(p => <option key={p.id} value={p.id}>{p.alias}</option>)}
            </select>
          </Campo>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--t3)', lineHeight: 1.4 }}>
            Al elegir, se planifica esta fase y podés ajustar fechas y duración.
          </div>
        </div>
      )}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  )
}

const input: CSSProperties = {
  width: '100%', padding: '6px 9px', border: '1.5px solid var(--line)', borderRadius: 8,
  fontSize: 13, fontWeight: 500, background: 'var(--white)', color: 'var(--ink)', cursor: 'pointer',
}
const stepBtn: CSSProperties = {
  width: 26, height: 26, border: '1.5px solid var(--line)', borderRadius: 9999, background: 'var(--white)',
  cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, color: 'var(--t1)', flexShrink: 0,
}
const iconBtn: CSSProperties = {
  border: '1.5px solid var(--line)', borderRadius: 8, background: 'var(--white)', cursor: 'pointer',
  fontSize: 13, lineHeight: 1, padding: '5px 8px', flexShrink: 0,
}
const moverBtn: CSSProperties = {
  padding: '5px 10px', border: '1.5px solid var(--line)', borderRadius: 9999, background: 'var(--white)',
  cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--t1)',
}
function pill(bg: string): CSSProperties {
  return { background: bg, color: '#fff', borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 600 }
}
