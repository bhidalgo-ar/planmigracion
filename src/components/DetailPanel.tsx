import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import type { Asignacion, Persona, Proyecto, TipoFase, Violacion } from '../types'
import { tierDe, TIER_LABEL, type Tier } from '../insightsEquipo'
import { TIPO_COLOR, TIPO_LABEL, ORDEN_FASES } from '../theme/fases'
import { feriadosDeConfig, formatFechaCorta, toISO } from '../utils/dates'
import { ddmm, margenesPorCuenta, nombreMes, origenCorteDe } from '../rules'
import { mesSalidaDe } from '../capacidad'
import { mesesCandidatos, planificarCuenta, simularDestinos, type Destino } from '../planificador'

const COLOR_TIER: Record<Tier, string> = {
  chica: 'var(--ok)', std: 'var(--celeste-dark)', grande: 'var(--fase-relev)', xl: 'var(--fase-cierre)',
}

export function DetailPanel() {
  const config = useSimuladorStore(s => s.config)
  const { proyectos, asignaciones, personas, violaciones, clienteSeleccionado, updateAsignacion, addFase, renameProyecto, removeProyecto } =
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
            Para mover una cuenta de mes, elegí el mes en "Sale en vivo": las fases se rearman hacia atrás desde el corte de novedades. En el timeline: arrastrá una barra para ajustarla a mano · vertical reasigna persona · borde derecho estira. Arrastrá el fondo (o usá el botón del medio del mouse) para desplazarte.
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
                ? <span style={pill(COLOR_TIER[t])}>Cuenta {TIER_LABEL[t]}</span>
                : <span style={pill('var(--gris)')}>tier sin definir</span> })()}
            </div>
          </div>

          {/* La causa: el mes de salida. Las fases de abajo son la consecuencia. */}
          <BloqueSalida proyecto={proyecto} />

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

/** Etiqueta corta de un mes 'YYYY-MM': 'oct 26'. */
function mesCortoDe(mes: string): string {
  return format(parseISO(`${mes}-01`), 'MMM yy', { locale: es })
}

const ESTILO_DESTINO: Record<Destino['estado'], { bg: string; bd: string; tx: string }> = {
  verde: { bg: 'var(--ok-bg)', bd: 'var(--ok-bd)', tx: 'var(--ok-tx)' },
  ambar: { bg: 'var(--warn-bg)', bd: 'var(--warn-bd)', tx: 'var(--warn-tx)' },
  rojo: { bg: 'var(--error-bg)', bd: 'var(--error-bd)', tx: 'var(--error-tx)' },
  gris: { bg: 'var(--line-soft)', bd: 'var(--line)', tx: 'var(--t3)' },
}

/**
 * La causa arriba, las consecuencias abajo: acá se elige el MES DE SALIDA de la cuenta y
 * las fechas de las fases se derivan del corte de novedades de ese mes. Cada mes candidato
 * se pinta según qué pasaría si la cuenta saliera ahí; al pasar el mouse, el timeline
 * muestra las fases fantasma en su lugar nuevo.
 */
function BloqueSalida({ proyecto }: { proyecto: Proyecto }) {
  const { asignaciones, personas, config, proyectos, moverCuentaAMes } = useSimuladorStore()
  const { setPrevisualizacion, ultimoMovimiento, setUltimoMovimiento } = useUIStore()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [proyecto.id])

  const feriados = useMemo(() => feriadosDeConfig(config), [config])
  const mesActual = mesSalidaDe(proyecto.id, config)
  const tieneCorte = typeof config.cortes_novedades_dia?.[proyecto.id] === 'number'
    || Object.keys(config.cortes_novedades_fechas?.[proyecto.id] ?? {}).length > 0
  const corteInfo = mesActual && tieneCorte ? origenCorteDe(proyecto.id, mesActual, config, feriados) : null
  const ORIGEN_TXT = { monday: 'fecha del cronograma', estimado: 'estimado', dia_fijo: 'día fijo' } as const
  const margen = useMemo(
    () => margenesPorCuenta(asignaciones, config, proyectos).find(m => m.proyectoId === proyecto.id)?.habiles ?? null,
    [asignaciones, config, proyectos, proyecto.id],
  )
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const meses = useMemo(() => mesesCandidatos(config, toISO(new Date())), [config])
  const destinos = useMemo(
    () => (tieneCorte ? simularDestinos(proyecto.id, meses, asignaciones, personas, config, proyectos) : []),
    [tieneCorte, proyecto.id, meses, asignaciones, personas, config, proyectos],
  )

  function previsualizar(mes: string) {
    const plan = planificarCuenta(proyecto.id, asignaciones, mes, config)
    setPrevisualizacion(plan.ok ? { proyectoId: proyecto.id, asignaciones: plan.asignaciones } : null)
  }
  function elegir(mes: string) {
    setPrevisualizacion(null)
    const r = moverCuentaAMes(proyecto.id, mes)
    if (!r.ok) { setError(r.motivo ?? 'No se pudo mover la cuenta.'); return }
    setError(null)
    setUltimoMovimiento(r.reporte ?? null)
  }

  const reporte = ultimoMovimiento?.proyectoId === proyecto.id ? ultimoMovimiento : null

  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--sh-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--celeste-dark)' }}>Sale en vivo</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{mesActual ? nombreMes(mesActual) : 'sin definir'}</span>
      </div>
      <div className="num" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {corteInfo && (
          <span title={corteInfo.origen === 'monday' ? 'El ítem ya está cargado en el cronograma de monday' : corteInfo.origen === 'estimado' ? 'Proyectado desde los cortes reales de 2026, corrido al hábil anterior' : 'Regla vieja: día fijo del mes'}>
            Corte de novedades <b style={{ color: 'var(--ink)' }}>{ddmm(corteInfo.fecha)}</b>
            <span style={{ color: 'var(--t3)' }}>{corteInfo.ronda ? ` · ${corteInfo.ronda}` : ''} · {ORIGEN_TXT[corteInfo.origen]}</span>
          </span>
        )}
        {margen !== null && (
          <span>Margen <b style={{ color: margen < minimo ? 'var(--error-tx)' : 'var(--ink)' }}>{margen} hábil{margen !== 1 ? 'es' : ''}</b> hasta el corte</span>
        )}
      </div>

      {!tieneCorte ? (
        <div style={{ marginTop: 10, fontSize: 11.5, padding: '7px 10px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 8, color: 'var(--warn-tx)', lineHeight: 1.4 }}>
          [FALTA: corte de novedades de {proyecto.nombre}] Sin ese dato no se puede ubicar la cuenta en un mes. Va en <code>config.cortes_novedades_dia</code>.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, fontSize: 10, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Moverla a</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {destinos.map(d => {
              const e = ESTILO_DESTINO[d.estado]
              const title = d.actual
                ? `Mes actual · corte ${d.corte ? ddmm(d.corte) : '—'} · margen ${d.margen ?? '—'} hábiles`
                : d.estado === 'gris'
                  ? d.motivo ?? ''
                  : `${d.motivo ?? 'Sin conflictos nuevos'} · corte ${d.corte ? ddmm(d.corte) : '—'} · margen ${d.margen ?? '—'} hábiles${d.deltaRojos < 0 ? ` · resuelve ${-d.deltaRojos} conflicto${-d.deltaRojos !== 1 ? 's' : ''}` : ''}`
              return (
                <button
                  key={d.mes}
                  disabled={d.estado === 'gris'}
                  title={title}
                  onMouseEnter={() => d.estado !== 'gris' && previsualizar(d.mes)}
                  onMouseLeave={() => setPrevisualizacion(null)}
                  onClick={() => elegir(d.mes)}
                  style={{
                    padding: '4px 9px', borderRadius: 9999, fontSize: 11, fontWeight: d.actual ? 800 : 600, cursor: d.estado === 'gris' ? 'not-allowed' : 'pointer',
                    background: e.bg, color: e.tx, border: `1.5px solid ${d.actual ? 'var(--celeste)' : e.bd}`,
                    boxShadow: d.actual ? '0 0 0 2px var(--celeste-dim)' : 'none', textTransform: 'capitalize',
                  }}
                >{mesCortoDe(d.mes)}</button>
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.4 }}>
            Verde entra sin conflictos nuevos · ámbar suma avisos · rojo rompe una regla. Pasá el mouse para ver las fases en el timeline; hacé clic para moverla. Las fechas se arman hacia atrás desde el corte; si después editás una fase a mano, volvé a elegir el mes para rearmarlas.
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11.5, padding: '6px 9px', background: 'var(--error-bg)', border: '1px solid var(--error-bd)', borderRadius: 8, color: 'var(--error-tx)' }}>{error}</div>
      )}

      {reporte && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--t2)' }}>Qué cambió</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t1)', lineHeight: 1.5 }}>
            {reporte.nombre}: <b>{reporte.mesAntes ? nombreMes(reporte.mesAntes) : 'sin mes'} → {nombreMes(reporte.mesDespues)}</b>. Corte {ddmm(reporte.corte)}, {reporte.margen} hábil{reporte.margen !== 1 ? 'es' : ''} de margen.
            {reporte.cierrePisaPruebas && ' La actualización final se pisa con las pruebas.'}
          </div>
          <div className="num" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t2)' }}>
            Conflictos {reporte.rojosAntes} → <b style={{ color: reporte.rojosDespues > reporte.rojosAntes ? 'var(--error-tx)' : 'var(--ink)' }}>{reporte.rojosDespues}</b> · Avisos {reporte.ambaresAntes} → <b style={{ color: 'var(--ink)' }}>{reporte.ambaresDespues}</b>
          </div>
          {reporte.nuevas.map((m, i) => (
            <div key={`n${i}`} style={{ marginTop: 4, fontSize: 11, padding: '5px 8px', background: 'var(--error-bg)', borderRadius: 6, color: 'var(--error-tx)' }}>{m}</div>
          ))}
          {reporte.resueltas.map((m, i) => (
            <div key={`r${i}`} style={{ marginTop: 4, fontSize: 11, padding: '5px 8px', background: 'var(--ok-bg)', borderRadius: 6, color: 'var(--ok-tx)' }}>Resuelto: {m}</div>
          ))}
          {reporte.cargas.length > 0 && (
            <div className="num" style={{ marginTop: 6, fontSize: 11, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {reporte.cargas.map(c => (
                <span key={`${c.alias}${c.mes}`}>{c.alias} en {nombreMes(c.mes).toLowerCase()}: {c.antes} → <b style={{ color: c.despues > c.capacidad ? 'var(--error-tx)' : 'var(--ink)' }}>{c.despues} h</b> de {c.capacidad}</span>
              ))}
            </div>
          )}
        </div>
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
function pill(bg: string): CSSProperties {
  return { background: bg, color: '#fff', borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 600 }
}
