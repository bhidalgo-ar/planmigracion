import { useMemo, useState } from 'react'
import { useSimuladorStore } from '../store'
import { formatFechaCorta } from '../utils/dates'
import { nombreMes } from '../rules'
import {
  cargaEquipo, fraseDelMes, lecturaTickets, matrizAnalistas, violacionesDe,
  type CargaPersonaEquipo, type FilaAnalista, type MatrizAnalistas,
} from '../insightsEquipo'
import { Card, Leyenda, Vacio } from './Insights'

const COLOR_ESTADO = { ok: 'var(--viz-axton)', ambar: 'var(--warn)', rojo: 'var(--error)' } as const
const TX_ESTADO = { ok: 'var(--ok-tx)', ambar: 'var(--warn-tx)', rojo: 'var(--error-tx)' } as const

/** 'Sep 26' a partir de '2026-09'. */
function mesCorto(mes: string): string {
  const n = nombreMes(mes)
  return `${n.slice(0, 3)} ${mes.slice(2, 4)}`
}

/**
 * Vista Equipo: qué le pasa al equipo de payroll mes a mes. Una columna de tarjetas a
 * 1280 px, sin scroll horizontal. Responde dos preguntas: cómo liquida cada analista a
 * medida que las cuentas pasan a Axton (y cuántos meses queda en dos sistemas), y cuántas
 * horas lleva cada persona de migración contra su capacidad. Cierra con la tabla de
 * tickets Meta 4, el insumo detrás de las curvas de soporte.
 */
export function Equipo() {
  const { personas, proyectos, asignaciones, config, violaciones } = useSimuladorStore()

  const d = useMemo(() => ({
    carga: cargaEquipo(personas, asignaciones, config),
    matriz: matrizAnalistas(proyectos, asignaciones, config),
  }), [personas, proyectos, asignaciones, config])

  const tickets = config.insumos?.tickets_meta4_ytd

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: 24, background: 'var(--lienzo)' }}>
      <div style={{ maxWidth: 1232, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

        <Card titulo="Cómo liquida cada analista, mes a mes"
          subtitulo="Por analista, cuántas cuentas liquida en Meta 4 y cuántas en Axton al cierre de cada mes, según el mes de salida del plan y quién lleva cada cuenta hoy. Las celdas ámbar son meses liquidando en dos sistemas: el objetivo es que duren lo menos posible.">
          {d.matriz
            ? <MatrizCard m={d.matriz} />
            : (
              <div style={{ fontSize: 12, color: 'var(--warn-tx)', lineHeight: 1.5 }}>
                <strong>[FALTA]</strong> la distribución de clientes por analista. Se extrae en modo lectura de la Matrix Complejidad Clientes (monday, board 6552205482) y se pega en <code style={{ fontSize: 11 }}>config.insumos.equipo_payroll_hoy.filas</code>. Hasta entonces esta tarjeta no dibuja nada.
              </div>
            )}
        </Card>

        <Card titulo="Horas por persona y mes contra su capacidad"
          subtitulo="La barra son las horas planificadas · la línea, la capacidad del mes (días hábiles × horas por día × disponibilidad). Rojo si la pasa, ámbar del 85 % en adelante. Clic en un mes para leer qué hace esa persona ese mes.">
          {d.carga.length === 0
            ? <Vacio>Nadie tiene fases asignadas todavía.</Vacio>
            : d.carga.map(c => (
              <FilaPersona key={c.id} c={c}
                frases={c.meses.map(m => fraseDelMes(c.alias, m, asignaciones, proyectos))}
                violaciones={c.meses.map(m => violacionesDe(violaciones, c.id, m.mes).filter(v => v.severidad !== 'info'))} />
            ))}
        </Card>

        <Card titulo="Tickets Meta4 en el año"
          subtitulo={tickets ? `${tickets.fuente ?? 'Ticketera de soporte'}${tickets.corte ? ` · corte ${formatFechaCorta(tickets.corte)}` : ''}` : undefined}>
          {tickets?.filas?.length ? <TicketsCard filas={tickets.filas} /> : <Vacio>El plan no trae la tabla de tickets Meta4 (config.insumos.tickets_meta4_ytd).</Vacio>}
        </Card>
      </div>
    </div>
  )
}

// ══ La matriz por analista ════════════════════════════════════════════════════

function MatrizCard({ m }: { m: MatrizAnalistas }) {
  const n = m.meses.length
  const cols = `150px repeat(${n}, minmax(0, 1fr)) 84px`
  const maxCuentas = Math.max(3, ...[...m.filas, ...m.soloAxton].flatMap(f => f.meses.map(c => c.meta4.length + c.axton.length)))
  const hayTickets = m.totales.some(t => t.ticketsAxton !== null)

  return (
    <div>
      <Leyenda series={[
        { key: 'm4', label: 'Cuentas en Meta 4', color: 'var(--viz-meta4)' },
        { key: 'ax', label: 'Cuentas en Axton', color: 'var(--viz-axton)' },
        { key: 'doble', label: 'Mes en dos sistemas', color: 'var(--warn-bd)' },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 6, rowGap: 6, alignItems: 'stretch' }}>
        {/* Encabezado: mes y qué sale ese mes */}
        <div />
        {m.totales.map(t => (
          <div key={t.mes} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>{mesCorto(t.mes)}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--viz-vivo)', lineHeight: 1.3, minHeight: 26 }}>{t.salen.join(', ')}</div>
          </div>
        ))}
        <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', alignSelf: 'end', lineHeight: 1.3 }}>Meses en<br />dos sistemas</div>

        {m.filas.map(f => <FilaMatriz key={f.analista} f={f} maxCuentas={maxCuentas} />)}
      </div>

      {/* Totales de cartera */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', alignSelf: 'center' }}>Total cartera</div>
        {m.totales.map(t => (
          <div key={t.mes} className="num" style={{ textAlign: 'center', fontSize: 11, color: 'var(--t2)', lineHeight: 1.4 }}>
            <b style={{ color: 'var(--ok-tx)' }}>{t.axton}</b> Axton · <b style={{ color: 'var(--ink)' }}>{t.meta4}</b> Meta 4
            {hayTickets && <><br /><span style={{ color: 'var(--celeste-deeper)', fontWeight: 700 }}>{t.ticketsAxton === null ? '[FALTA]' : `${Math.round(t.ticketsAxton)} tk/mes`}</span></>}
          </div>
        ))}
        <div />
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5 }}>
        {m.soloAxton.length > 0 && <>Siguen 100 % en Axton, sin cambios: {m.soloAxton.map(f => `${f.analista} (${f.cuentasHoy})`).join(', ')}. </>}
        {m.otrosEquipos.length > 0 && <>Las liquida otro equipo de H&A, fuera del equipo de payroll: {m.otrosEquipos.map(o => `${o.cuenta} (${o.equipo})`).join(', ')}. </>}
        {m.sinAnalista.length > 0 && <>Migran pero no tienen fila en la Matrix: {m.sinAnalista.join(', ')} <strong style={{ color: 'var(--warn-tx)' }}>[FALTA: analista]</strong>. </>}
        {hayTickets
          ? <>Los tickets por mes salen de la ticketera cargada en el plan (config.soporte_tickets).</>
          : <>Tickets por mes: <strong style={{ color: 'var(--warn-tx)' }}>[FALTA: config.soporte_tickets]</strong>.</>}
        {(m.fuente || m.corte) && <> Fuente: {m.fuente ?? 'Matrix Complejidad Clientes'}{m.corte ? ` · corte ${m.corte}` : ''}.</>}
      </div>
    </div>
  )
}

function FilaMatriz({ f, maxCuentas }: { f: FilaAnalista; maxCuentas: number }) {
  const n = f.mesesDobles
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: f.analista.startsWith('[FALTA') ? 'var(--warn-tx)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.analista}</span>
        <span className="num" style={{ fontSize: 10.5, color: 'var(--t3)' }}>{f.cuentasHoy} cuenta{f.cuentasHoy !== 1 ? 's' : ''} hoy</span>
      </div>
      {f.meses.map(c => {
        const m4 = c.meta4.length, ax = c.axton.length
        const doble = m4 > 0 && ax > 0
        const title = [m4 ? `Meta 4: ${c.meta4.join(', ')}` : '', ax ? `Axton: ${c.axton.join(', ')}` : ''].filter(Boolean).join(' · ')
        return (
          <div key={c.mes} title={title} style={{
            minHeight: 40, borderRadius: 8, padding: '5px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
            background: doble ? 'var(--warn-bg)' : 'transparent', border: `1px solid ${doble ? 'var(--warn-bd)' : 'transparent'}`,
          }}>
            <div style={{ display: 'flex', gap: 2, height: 8 }}>
              {m4 > 0 && <div style={{ width: `${(m4 / maxCuentas) * 100}%`, background: 'var(--viz-meta4)', borderRadius: 2 }} />}
              {ax > 0 && <div style={{ width: `${(ax / maxCuentas) * 100}%`, background: 'var(--viz-axton)', borderRadius: 2 }} />}
            </div>
            <div className="num" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {m4 > 0 && <><span style={{ color: 'var(--ink)' }}>{m4}</span> Meta 4</>}
              {m4 > 0 && ax > 0 && ' · '}
              {ax > 0 && <><span style={{ color: 'var(--ok-tx)' }}>{ax}</span> Axton</>}
            </div>
          </div>
        )
      })}
      <div className="num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: n >= 3 ? 'var(--warn-tx)' : n > 0 ? 'var(--ink)' : 'var(--t3)' }}>
        {n > 0 ? n : '—'}
      </div>
    </>
  )
}

// ══ Horas por persona, una fila a todo el ancho ═══════════════════════════════

function FilaPersona({ c, frases, violaciones }: {
  c: CargaPersonaEquipo; frases: string[]; violaciones: Array<Array<{ mensaje: string; severidad: string }>>
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const maxH = Math.max(1, ...c.meses.map(m => Math.max(m.horas, m.capacidad)))
  const H = 130
  const rojos = c.meses.filter(m => m.estado === 'rojo')
  const pico = c.pico
  const idxPico = pico ? c.meses.findIndex(m => m.mes === pico.mes) : -1

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 18, padding: '12px 0', borderTop: '1px solid var(--line-soft)' }}>
      {/* La lectura, a la izquierda: total, pico y si se pasa */}
      <div style={{ alignSelf: 'center', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{c.alias}</div>
        <div className="num" style={{ fontSize: 11.5, color: 'var(--t2)' }}>{c.total} h en el programa · {c.horasDia} h/día</div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--t2)', lineHeight: 1.45 }}>
          {pico && <>Pico en {mesCorto(pico.mes)}: {Math.round(pico.horas)} h de {Math.round(pico.capacidad)}{idxPico >= 0 && frases[idxPico] ? '' : ''}. </>}
          {rojos.length
            ? <strong style={{ color: 'var(--error-tx)' }}>Se pasa en {rojos.map(m => mesCorto(m.mes)).join(', ')}.</strong>
            : <span>Nunca pasa su capacidad.</span>}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {/* Barras por mes con la capacidad como línea encima */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: H + 40, borderBottom: '1px solid var(--line-soft)' }}>
          {c.meses.map((m, i) => {
            const hBar = (m.horas / maxH) * H
            const hCap = (m.capacidad / maxH) * H
            const activo = abierto === m.mes
            return (
              <button key={m.mes} onClick={() => setAbierto(activo ? null : m.mes)}
                title={`${nombreMes(m.mes)}: ${Math.round(m.horas)} h de ${Math.round(m.capacidad)} (disponibilidad ${Math.round(m.disponibilidad * 100)} %)`}
                style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative', border: 'none', background: activo ? 'var(--celeste-dim)' : 'transparent', borderRadius: 6, cursor: frases[i] ? 'pointer' : 'default', padding: 0 }}>
                <div style={{ position: 'absolute', left: '22%', right: '22%', bottom: 20, height: hBar, background: COLOR_ESTADO[m.estado], borderRadius: '3px 3px 0 0', opacity: m.horas ? 1 : 0 }} />
                <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: 20 + hCap, borderTop: '2px solid var(--ink)', opacity: m.capacidad ? 0.85 : 0 }} />
                {m.horas > 0 && (
                  <span className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 20 + Math.max(hBar, hCap) + 4, fontSize: 11, fontWeight: 800, color: TX_ESTADO[m.estado], textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {Math.round(m.horas)} h · {Math.round(m.uso * 100)} %
                  </span>
                )}
                <span className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 3, fontSize: 10.5, color: 'var(--t3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {mesCorto(m.mes)}
                </span>
              </button>
            )
          })}
        </div>

        {/* La prosa del mes elegido: qué hace y con qué cuentas */}
        {abierto && c.meses.map((m, i) => {
          if (m.mes !== abierto || !frases[i]) return null
          const v = violaciones[i]
          return (
            <div key={m.mes} style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.45, color: 'var(--t1)', paddingLeft: 8, borderLeft: `3px solid ${COLOR_ESTADO[m.estado]}` }}>
              <strong style={{ color: 'var(--ink)' }}>{nombreMes(m.mes)}:</strong> {frases[i].replace(`${c.alias} `, '')}
              {v.length > 0 && (
                <div style={{ marginTop: 2, color: v.some(x => x.severidad === 'rojo') ? 'var(--error-tx)' : 'var(--warn-tx)', fontSize: 11 }}>
                  {v.map((x, k) => <div key={k}>↳ {x.mensaje}</div>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══ Insumo: tickets ═══════════════════════════════════════════════════════════

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 28, rowGap: 5 }}>
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
