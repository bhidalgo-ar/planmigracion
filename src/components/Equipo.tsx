import { useMemo, useState } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { formatFechaCorta } from '../utils/dates'
import { TIPO_LABEL } from '../theme/fases'
import { nombreMes } from '../rules'
import type { TipoFase } from '../types'
import {
  cargaEquipo, cuentasEquipo, equipoHoy, franjaSalidas, fraseDelMes, lecturaTickets, violacionesDe,
  TIER_LABEL, type CargaPersonaEquipo, type CuentaEquipo, type FranjaMes,
} from '../insightsEquipo'
import { Card, Leyenda, Th, Td, Vacio } from './Insights'

const VIZ_FASE: Record<TipoFase, string> = {
  Relevamiento: 'var(--viz-relev)', Configuracion: 'var(--viz-config)', Pruebas: 'var(--viz-vivo)',
  Cierre: 'var(--viz-cierre)', Vacaciones: 'var(--fase-bloqueo)',
}
const COLOR_ESTADO = { ok: 'var(--viz-axton)', ambar: 'var(--warn)', rojo: 'var(--error)' } as const
const TX_ESTADO = { ok: 'var(--ok-tx)', ambar: 'var(--warn-tx)', rojo: 'var(--error-tx)' } as const

/** 'Sep 26' a partir de '2026-09'. */
function mesCorto(mes: string): string {
  const n = nombreMes(mes)
  return `${n.slice(0, 3)} ${mes.slice(2, 4)}`
}

/**
 * Vista Equipo: qué le pasa al equipo de payroll mes a mes. Una columna de tarjetas a
 * 1280 px, sin scroll horizontal. Responde cuatro preguntas: cuántas horas lleva cada
 * persona contra su capacidad, qué se solapa y cuánto suma, quién hace qué en cada cuenta
 * y qué sale en vivo cada mes. Cierra con los dos insumos que justifican las decisiones.
 */
export function Equipo() {
  const { personas, proyectos, asignaciones, config, violaciones } = useSimuladorStore()
  const seleccionarCliente = useSimuladorStore(s => s.seleccionarCliente)
  const setVista = useUIStore(s => s.setVista)

  const d = useMemo(() => ({
    carga: cargaEquipo(personas, asignaciones, config),
    cuentas: cuentasEquipo(proyectos, asignaciones, config),
    franja: franjaSalidas(proyectos, asignaciones, config),
    hoy: equipoHoy(config),
  }), [personas, proyectos, asignaciones, config])

  function irACuenta(id: string) {
    seleccionarCliente(id)
    setVista('timeline')
  }

  const tickets = config.insumos?.tickets_meta4_ytd
  const aliasDe = (id: string) => personas.find(p => p.id === id)?.alias ?? id

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 24, background: 'var(--lienzo)' }}>
      <div style={{ maxWidth: 1232, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* B1 + B2: carga por persona con la prosa del mes */}
        <Card titulo="Horas por persona y mes contra su capacidad"
          subtitulo="La barra son las horas planificadas · la línea, la capacidad del mes (días hábiles × horas por día × disponibilidad). Rojo si la pasa, ámbar del 85 % en adelante.">
          {d.carga.length === 0
            ? <Vacio>Nadie tiene fases asignadas todavía.</Vacio>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, d.carga.length)}, minmax(0, 1fr))`, gap: 16 }}>
                {d.carga.map(c => (
                  <PersonaCard key={c.id} c={c}
                    frases={c.meses.map(m => fraseDelMes(c.alias, m, asignaciones, proyectos))}
                    violaciones={c.meses.map(m => violacionesDe(violaciones, c.id, m.mes).filter(v => v.severidad !== 'info'))} />
                ))}
              </div>
            )}
        </Card>

        {/* B3: quién hace qué en cada cuenta */}
        <Card titulo="Quién hace qué en cada cuenta"
          subtitulo="Ordenadas por mes de salida · tier, corte de novedades y margen en días hábiles · a la derecha las fases en carriles por persona">
          <Leyenda series={(['Relevamiento', 'Configuracion', 'Pruebas', 'Cierre'] as TipoFase[]).map(t => ({ key: t, label: TIPO_LABEL[t], color: VIZ_FASE[t] }))} />
          {d.cuentas.length === 0
            ? <Vacio>Sin cuentas planificadas.</Vacio>
            : <TablaCuentas cuentas={d.cuentas} aliasDe={aliasDe} onCuenta={irACuenta} />}
        </Card>

        {/* B4: la franja de salidas */}
        <Card titulo="Salidas en vivo por mes"
          subtitulo={`Tope ${config.reglas_calendario?.tope_salidas_en_vivo_por_mes ?? '—'} por mes (3 si dos son chicas) · margen mínimo ${config.capacidad?.margen_minimo_habiles ?? 5} días hábiles hasta el corte de novedades`}>
          <Franja franja={d.franja} onCuenta={irACuenta} />
        </Card>

        {/* B5: insumos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 18 }}>
          <Card titulo="Tickets Meta4 en el año"
            subtitulo={tickets ? `${tickets.fuente ?? 'Ticketera de soporte'}${tickets.corte ? ` · corte ${formatFechaCorta(tickets.corte)}` : ''}` : undefined}>
            {tickets?.filas?.length ? <TicketsCard filas={tickets.filas} /> : <Vacio>El plan no trae la tabla de tickets Meta4 (config.insumos.tickets_meta4_ytd).</Vacio>}
          </Card>
          <Card titulo="Equipo de payroll hoy"
            subtitulo={d.hoy ? `${d.hoy.fuente ?? 'Matrix Complejidad Clientes'}${d.hoy.corte ? ` · corte ${d.hoy.corte}` : ''}` : 'Clientes por analista y por sistema'}>
            {d.hoy ? <EquipoHoyCard datos={d.hoy} /> : (
              <div style={{ fontSize: 12, color: 'var(--warn-tx)', lineHeight: 1.5 }}>
                <strong>[FALTA]</strong> la distribución actual del equipo por cliente. Se extrae en modo lectura de la Matrix Complejidad Clientes (monday, board 6552205482) y se pega en <code style={{ fontSize: 11 }}>config.insumos.equipo_payroll_hoy.filas</code> con su fecha de corte. Hasta entonces esta tarjeta no dibuja nada.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ══ B1 + B2 ═══════════════════════════════════════════════════════════════════

function PersonaCard({ c, frases, violaciones }: {
  c: CargaPersonaEquipo; frases: string[]; violaciones: Array<Array<{ mensaje: string; severidad: string }>>
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const maxH = Math.max(1, ...c.meses.map(m => Math.max(m.horas, m.capacidad)))
  const H = 120
  const mesesRojos = c.meses.filter(m => m.estado === 'rojo').length

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{c.alias}</span>
        <span className="num" style={{ fontSize: 12, color: 'var(--t2)' }}>{c.total} h en el programa</span>
        {c.pico && (
          <span className="num" style={{ marginLeft: 'auto', fontSize: 11, color: c.pico.estado === 'rojo' ? 'var(--error-tx)' : 'var(--t3)', whiteSpace: 'nowrap' }}>
            pico {mesCorto(c.pico.mes)} · {Math.round(c.pico.horas)} h{c.pico.estado === 'rojo' ? ' ⚠' : ''}
          </span>
        )}
      </div>

      {/* Barras por mes con la capacidad como línea encima */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: H + 18, borderBottom: '1px solid var(--line-soft)' }}>
        {c.meses.map((m, i) => {
          const hBar = (m.horas / maxH) * H
          const hCap = (m.capacidad / maxH) * H
          const activo = abierto === m.mes
          return (
            <button key={m.mes} onClick={() => setAbierto(activo ? null : m.mes)}
              title={`${nombreMes(m.mes)}: ${Math.round(m.horas)} h de ${Math.round(m.capacidad)} (disponibilidad ${Math.round(m.disponibilidad * 100)} %)`}
              style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative', border: 'none', background: activo ? 'var(--celeste-dim)' : 'transparent', borderRadius: 6, cursor: frases[i] ? 'pointer' : 'default', padding: 0 }}>
              <div style={{ position: 'absolute', left: '15%', right: '15%', bottom: 18, height: hBar, background: COLOR_ESTADO[m.estado], borderRadius: '3px 3px 0 0', opacity: m.horas ? 1 : 0 }} />
              <div style={{ position: 'absolute', left: '6%', right: '6%', bottom: 18 + hCap, borderTop: '2px solid var(--ink)', opacity: m.capacidad ? 0.85 : 0 }} />
              {m.horas > 0 && (
                <span className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 18 + Math.max(hBar, hCap) + 2, fontSize: 10, fontWeight: 700, color: TX_ESTADO[m.estado], textAlign: 'center' }}>
                  {Math.round(m.horas)}
                </span>
              )}
              <span className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 2, fontSize: 9.5, color: 'var(--t3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {mesCorto(m.mes)}
              </span>
            </button>
          )
        })}
      </div>

      {/* La prosa: el solapamiento explicado (todos los meses con carga, o solo el elegido) */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {c.meses.map((m, i) => {
          if (!frases[i]) return null
          if (abierto && abierto !== m.mes) return null
          const v = violaciones[i]
          return (
            <div key={m.mes} style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--t1)', paddingLeft: 8, borderLeft: `3px solid ${COLOR_ESTADO[m.estado]}` }}>
              <strong style={{ color: 'var(--ink)' }}>{nombreMes(m.mes).split(' ')[0]}:</strong> {frases[i].replace(`${c.alias} `, '')}
              {v.length > 0 && (
                <div style={{ marginTop: 2, color: v.some(x => x.severidad === 'rojo') ? 'var(--error-tx)' : 'var(--warn-tx)', fontSize: 11 }}>
                  {v.map((x, k) => <div key={k}>↳ {x.mensaje}</div>)}
                </div>
              )}
            </div>
          )
        })}
        {mesesRojos > 0 && !abierto && (
          <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{mesesRojos} mes{mesesRojos !== 1 ? 'es' : ''} por encima de la capacidad. Clic en una barra para ver solo ese mes.</span>
        )}
      </div>
    </div>
  )
}

// ══ B3 ════════════════════════════════════════════════════════════════════════

function TablaCuentas({ cuentas, aliasDe, onCuenta }: {
  cuentas: CuentaEquipo[]; aliasDe: (id: string) => string; onCuenta: (id: string) => void
}) {
  const desde = cuentas.reduce((m, c) => (c.fases[0].inicio < m ? c.fases[0].inicio : m), cuentas[0].fases[0].inicio)
  const hasta = cuentas.reduce((m, c) => {
    const fin = c.fases.reduce((x, f) => (f.fin > x ? f.fin : x), c.fases[0].fin)
    const corte = c.corte ?? fin
    const h = fin > corte ? fin : corte
    return h > m ? h : m
  }, cuentas[0].fases[0].fin)
  const t0 = new Date(desde).getTime()
  const span = Math.max(1, new Date(hasta).getTime() - t0)
  const pct = (iso: string) => Math.min(100, Math.max(0, ((new Date(iso).getTime() - t0) / span) * 100))
  const LANE = 7

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 96 }} /><col style={{ width: 64 }} /><col style={{ width: 62 }} /><col style={{ width: 62 }} /><col style={{ width: 70 }} /><col />
        </colgroup>
        <thead>
          <tr>
            <Th align="left">Cuenta</Th><Th align="left">Tier</Th><Th align="left">Sale</Th><Th align="left">Corte</Th><Th>Margen</Th>
            <Th align="left">Fases por persona</Th>
          </tr>
        </thead>
        <tbody>
          {cuentas.map(c => (
            <tr key={c.id} style={{ borderTop: '1px solid var(--line-soft)' }}>
              <Td align="left">
                <button onClick={() => onCuenta(c.id)} title={`Ver ${c.nombre} en el timeline`}
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', textAlign: 'left' }}>
                  {c.nombre}
                </button>
              </Td>
              <Td align="left"><span style={{ color: 'var(--t2)' }}>{c.tier ? TIER_LABEL[c.tier] : 'sin tier'}</span></Td>
              <Td align="left"><span className="num">{c.mesSalida ? mesCorto(c.mesSalida) : '—'}</span></Td>
              <Td align="left"><span className="num">{c.corte ? formatFechaCorta(c.corte) : '—'}</span></Td>
              <Td>
                <span className="num" style={{ fontWeight: 700, color: c.estadoMargen === 'rojo' ? 'var(--error-tx)' : c.estadoMargen === 'ok' ? 'var(--ok-tx)' : 'var(--t3)' }}>
                  {c.margen == null ? '—' : `${c.margen} háb.`}
                </span>
              </Td>
              <td style={{ padding: '4px 6px' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                  <div style={{ width: 44, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {c.personas.map(pid => (
                      <span key={pid} style={{ height: LANE, fontSize: 8.5, lineHeight: `${LANE}px`, fontWeight: 700, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{aliasDe(pid)}</span>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, position: 'relative', height: c.personas.length * (LANE + 1) }}>
                    {c.personas.map((pid, lane) => c.fases.filter(f => f.persona_id === pid).map(f => {
                      const left = pct(f.inicio)
                      const width = Math.max(0.4, pct(f.fin) - left)
                      return (
                        <div key={f.id} title={`${aliasDe(pid)} · ${TIPO_LABEL[f.tipo]} · ${formatFechaCorta(f.inicio)} → ${formatFechaCorta(f.fin)} · ${Math.round(f.dedicacion_pct * 100)} %`}
                          style={{ position: 'absolute', top: lane * (LANE + 1), left: `${left}%`, width: `${width}%`, height: LANE, background: VIZ_FASE[f.tipo], borderRadius: 2, opacity: 0.55 + 0.45 * Math.min(1, f.dedicacion_pct) }} />
                      )
                    }))}
                    {c.corte && (
                      <div title={`Corte de novedades ${formatFechaCorta(c.corte)}`}
                        style={{ position: 'absolute', top: -1, bottom: -1, left: `${pct(c.corte)}%`, borderLeft: `2px dashed ${c.estadoMargen === 'rojo' ? 'var(--error)' : 'var(--t3)'}` }} />
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ══ B4 ════════════════════════════════════════════════════════════════════════

function Franja({ franja, onCuenta }: { franja: FranjaMes[]; onCuenta: (id: string) => void }) {
  if (!franja.length) return <Vacio>Sin meses que mostrar.</Vacio>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${franja.length}, minmax(0, 1fr))`, gap: 6 }}>
      {franja.map(f => (
        <div key={f.mes} style={{ minWidth: 0, borderTop: `3px solid ${COLOR_ESTADO[f.estado]}`, background: 'var(--paper)', borderRadius: '0 0 8px 8px', padding: '6px 6px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)' }}>{mesCorto(f.mes)}</span>
            <span className="num" style={{ marginLeft: 'auto', fontSize: 10, color: f.estadoTope === 'rojo' ? 'var(--error-tx)' : 'var(--t3)' }}>
              {f.salidas.length}{f.tope != null ? `/${f.tope}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
            {f.salidas.length === 0 && <span style={{ fontSize: 10, color: 'var(--t3)', fontStyle: 'italic' }}>sin salidas</span>}
            {f.salidas.map(s => (
              <div key={s.nombre} title={s.fueraDelPlan ? `${s.nombre}: fuera del simulador (ya configurada)` : `${s.nombre}${s.corte ? ` · corte ${formatFechaCorta(s.corte)}` : ''}${s.margen != null ? ` · margen ${s.margen} háb.` : ''}`}
                style={{ fontSize: 10.5, lineHeight: 1.3, minWidth: 0 }}>
                {s.id ? (
                  <button onClick={() => onCuenta(s.id!)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontWeight: 700, color: 'var(--ink)', fontSize: 10.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textAlign: 'left' }}>{s.nombre}</button>
                ) : (
                  <span style={{ fontWeight: 700, color: 'var(--t2)' }}>{s.nombre}</span>
                )}
                <span className="num" style={{ color: s.fueraDelPlan ? 'var(--t3)' : s.estado === 'rojo' ? 'var(--error-tx)' : 'var(--t2)' }}>
                  {s.fueraDelPlan ? 'fuera del simulador' : s.margen == null ? 'sin corte' : `${s.margen} háb.${s.tier === 'chica' ? ' · chica' : ''}`}
                </span>
              </div>
            ))}
          </div>
          {f.estadoTope === 'permitido' && <div style={{ fontSize: 9.5, color: 'var(--warn-tx)', marginTop: 4 }}>3 permitidas: dos son chicas</div>}
          {f.estadoTope === 'rojo' && <div style={{ fontSize: 9.5, color: 'var(--error-tx)', marginTop: 4 }}>se pasa del tope</div>}
        </div>
      ))}
    </div>
  )
}

// ══ B5 ════════════════════════════════════════════════════════════════════════

function TicketsCard({ filas }: { filas: Array<{ cliente: string; tickets: number; pct_criticas: number; peso: number; escalados: number }> }) {
  const orden = [...filas].sort((a, b) => b.tickets - a.tickets)
  const max = Math.max(1, ...orden.map(f => f.tickets))
  // Color por % de críticas: tres escalones legibles, no un degradé.
  const colorCriticas = (p: number) => p >= 60 ? 'var(--error)' : p >= 40 ? 'var(--warn)' : 'var(--viz-config)'
  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600, marginBottom: 10 }}>{lecturaTickets(filas)}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8, fontSize: 10.5, color: 'var(--t2)' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--viz-config)', marginRight: 4 }} />&lt; 40 % críticas</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--warn)', marginRight: 4 }} />40 a 60 %</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--error)', marginRight: 4 }} />≥ 60 %</span>
        <span>▲ escalados</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {orden.map(f => (
          <div key={f.cliente} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 118px', gap: 8, alignItems: 'center', fontSize: 11 }}>
            <span style={{ fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.cliente}</span>
            <div style={{ position: 'relative', height: 14 }} title={`${f.cliente}: ${f.tickets} tickets · ${f.pct_criticas} % críticas · peso ${f.peso} · ${f.escalados} escalados`}>
              <div style={{ width: `${(f.tickets / max) * 100}%`, height: '100%', background: colorCriticas(f.pct_criticas), borderRadius: 3, opacity: 0.9 }} />
              {Array.from({ length: Math.min(f.escalados, 8) }).map((_, i) => (
                <span key={i} style={{ position: 'absolute', top: -5, left: `calc(${(f.tickets / max) * 100}% + ${4 + i * 7}px)`, fontSize: 7, color: 'var(--t2)' }}>▲</span>
              ))}
              {f.escalados > 8 && <span style={{ position: 'absolute', top: -4, left: `calc(${(f.tickets / max) * 100}% + 62px)`, fontSize: 8, color: 'var(--t3)' }}>+{f.escalados - 8}</span>}
            </div>
            <span className="num" style={{ color: 'var(--t2)', whiteSpace: 'nowrap' }}>
              <strong style={{ color: 'var(--ink)' }}>{f.tickets}</strong> · {Math.round(f.pct_criticas)} % · {f.escalados} esc.
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EquipoHoyCard({ datos }: { datos: NonNullable<ReturnType<typeof equipoHoy>> }) {
  const [porLider, setPorLider] = useState(false)
  const grupos = porLider ? datos.porLider : datos.porAnalista
  const max = Math.max(1, ...grupos.map(a => a.meta4 + a.axton + a.otros))
  const t = datos.total
  return (
    <div>
      {/* El número que manda: cuántas cuentas soporta cada herramienta hoy */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        <div><span className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>{t.meta4}</span> <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>en Meta4</span></div>
        <div><span className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--viz-axton)' }}>{t.axton}</span> <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>en Axton</span></div>
        {t.otros > 0 && <div><span className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--t3)' }}>{t.otros}</span> <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>otros</span></div>}
        <button onClick={() => setPorLider(v => !v)} style={{ marginLeft: 'auto', alignSelf: 'center', padding: '3px 10px', border: '1.5px solid var(--line)', borderRadius: 9999, background: 'var(--white)', color: 'var(--t2)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          {porLider ? 'Por analista' : 'Por equipo'}
        </button>
      </div>
      <Leyenda series={[{ key: 'm', label: 'Meta4', color: 'var(--viz-meta4)' }, { key: 'a', label: 'Axton', color: 'var(--viz-axton)' }]} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {grupos.map(a => (
          <div key={a.nombre}>
            <div style={{ display: 'flex', gap: 6, fontSize: 11.5, marginBottom: 2 }}>
              <span style={{ fontWeight: 700, color: a.nombre.startsWith('[FALTA') ? 'var(--warn-tx)' : 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nombre}</span>
              <span className="num" style={{ marginLeft: 'auto', color: 'var(--t2)', whiteSpace: 'nowrap' }}>{a.meta4} Meta4 · {a.axton} Axton{a.otros ? ` · ${a.otros} otros` : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 10 }}>
              {a.meta4 > 0 && <div style={{ width: `${(a.meta4 / max) * 100}%`, background: 'var(--viz-meta4)', borderRadius: 2 }} />}
              {a.axton > 0 && <div style={{ width: `${(a.axton / max) * 100}%`, background: 'var(--viz-axton)', borderRadius: 2 }} />}
              {a.otros > 0 && <div style={{ width: `${(a.otros / max) * 100}%`, background: 'var(--fase-bloqueo)', borderRadius: 2 }} />}
            </div>
          </div>
        ))}
      </div>
      {datos.nota && <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.4 }}>{datos.nota}</div>}
    </div>
  )
}
