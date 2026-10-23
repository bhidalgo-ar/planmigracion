import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { mesaDeSalidas, ETAPAS, type TarjetaSalida } from '../vistasPrograma'
import { simularDestinos, simularDestinosNivelado, type Destino } from '../planificador'
import { nombreMes } from '../rules'
import { toISO } from '../utils/dates'

const COLOR_ETAPA: Record<string, string> = {
  Relevamiento: 'var(--fase-relev)', Configuracion: 'var(--fase-config)', Pruebas: 'var(--fase-pruebas)', Cierre: 'var(--fase-cierre)',
}

/** Estilo de cada columna mientras se arrastra una cuenta, según qué pasaría si sale ese mes. */
const ESTILO_SIM: Record<Destino['estado'], { bg: string; bd: string; tx: string }> = {
  verde: { bg: 'var(--ok-bg)', bd: 'var(--ok-bd)', tx: 'var(--ok-tx)' },
  ambar: { bg: 'var(--warn-bg)', bd: 'var(--warn-bd)', tx: 'var(--warn-tx)' },
  rojo: { bg: 'var(--error-bg)', bd: 'var(--error-bd)', tx: 'var(--error-tx)' },
  gris: { bg: 'var(--line-soft)', bd: 'var(--line)', tx: 'var(--t2)' },
}

/**
 * Vista Salidas (A, 23/10/2026): el plan como una mesa de meses. Cada cuenta es una tarjeta en
 * el mes en que sale en vivo; mover una cuenta es arrastrar su tarjeta a otro mes. Mientras se
 * arrastra, cada mes dice si la cuenta entra y, si no, por qué (el mismo cálculo que la tira
 * "Sale en vivo" del panel). Debajo, en las mismas columnas, cómo está el equipo ese mes.
 */
export function MesaSalidas() {
  const { personas, proyectos, asignaciones, config, violaciones, moverCuentaAMes, seleccionarCliente } = useSimuladorStore()
  const { respetarCapacidad, setVista } = useUIStore()
  const hoyISO = toISO(new Date())
  const mesa = useMemo(() => mesaDeSalidas({ personas, proyectos, asignaciones, config }, hoyISO), [personas, proyectos, asignaciones, config, hoyISO])
  const rojos = violaciones.filter(v => v.severidad === 'rojo').length

  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [destinos, setDestinos] = useState<Map<string, Destino> | null>(null)
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 9000); return () => clearTimeout(t) }, [aviso])

  const mesesIds = mesa.meses.map(m => m.mes)
  function empezar(e: DragEvent, t: TarjetaSalida) {
    e.dataTransfer.setData('text/plain', t.id)
    e.dataTransfer.effectAllowed = 'move'
    setArrastrando(t.id)
    setDestinos(null)
    // El cálculo de cada mes tarda: se hace después de que el navegador empieza el arrastre.
    setTimeout(() => {
      const ds = respetarCapacidad
        ? simularDestinosNivelado(t.id, mesesIds, asignaciones, personas, config, proyectos, hoyISO)
        : simularDestinos(t.id, mesesIds, asignaciones, personas, config, proyectos)
      setDestinos(new Map(ds.map(d => [d.mes, d])))
    }, 30)
  }
  function terminar() { setArrastrando(null); setDestinos(null) }
  function soltar(mes: string) {
    const id = arrastrando
    terminar()
    if (!id) return
    const p = proyectos.find(x => x.id === id)
    const r = moverCuentaAMes(id, mes, respetarCapacidad)
    if (!r.ok) { setAviso({ tono: 'error', texto: `${p?.nombre ?? id}: ${r.motivo ?? 'no se pudo mover.'}` }); return }
    const rep = r.reporte
    setAviso({
      tono: rep?.noEntra ? 'error' : 'ok',
      texto: rep
        ? `${rep.nombre}: ${rep.mesAntes ? nombreMes(rep.mesAntes) : 'sin mes'} → ${nombreMes(rep.mesDespues)}. Conflictos ${rep.rojosAntes} → ${rep.rojosDespues}.${rep.noEntra ? ` No entra respetando capacidad: ${rep.noEntra}` : ''}`
        : `${p?.nombre ?? id} movida a ${nombreMes(mes)}.`,
    })
  }
  const nombreArrastrada = arrastrando ? proyectos.find(p => p.id === arrastrando)?.nombre : null
  const verdes = destinos ? [...destinos.values()].filter(d => d.estado === 'verde' || d.estado === 'ambar').map(d => nombreMes(d.mes).toLowerCase()) : []

  const cols = `112px repeat(${mesa.meses.length}, minmax(84px, 1fr))`

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--lienzo)' }}>
      <section style={{ padding: '18px 24px 6px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 26px' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{mesa.titular}</h1>
        <div className="num" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 13.5, color: 'var(--t2)' }}>
          <span><b style={{ color: 'var(--ink)' }}>{mesa.enAxtonHoy}</b> en Axton hoy</span>
          <span><b style={{ color: 'var(--ink)' }}>{mesa.porMigrar}</b> por migrar</span>
          {mesa.quedanEnMeta4 > 0 && <span><b style={{ color: 'var(--ink)' }}>{mesa.quedanEnMeta4}</b> se quedan en Meta 4</span>}
          {mesa.pico && <span>pico del equipo <b style={{ color: 'var(--ink)' }}>{mesa.pico.pct} %</b>, {mesa.pico.alias} en {nombreMes(mesa.pico.mes).split(' ')[0].toLowerCase()}</span>}
          <span style={{ color: rojos ? 'var(--error-tx)' : 'var(--ok-tx)', fontWeight: 700 }}>{rojos ? `${rojos} en rojo` : 'nada en rojo'}</span>
        </div>
      </section>

      <div role="status" style={{ margin: '8px 24px 12px', minHeight: 44, padding: '10px 14px', borderRadius: 12, background: 'var(--white)', border: `2px solid ${arrastrando ? 'var(--celeste)' : aviso ? (aviso.tono === 'ok' ? 'var(--ok-bd)' : 'var(--error-bd)') : 'var(--line)'}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', boxSizing: 'border-box' }}>
        {arrastrando ? (
          <>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--celeste-deeper)' }}>Moviendo {nombreArrastrada}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t1)' }}>
              {!destinos ? 'Calculando en qué meses entra…' : verdes.length ? `Entra en ${verdes.join(', ')}. En los meses en rojo choca con otra cuenta o con alguien sin lugar.` : 'No entra en ningún otro mes sin agregar conflictos.'}
            </span>
          </>
        ) : aviso ? (
          <span style={{ fontSize: 13.5, color: aviso.tono === 'ok' ? 'var(--ok-tx)' : 'var(--error-tx)', fontWeight: 600 }}>{aviso.texto}</span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--t2)' }}>Arrastrá una cuenta a otro mes para cambiar su salida · clic en una cuenta para verla en el Timeline · {respetarCapacidad ? 'respetando la capacidad del equipo' : 'con el planificador clásico'}</span>
        )}
      </div>

      <div style={{ margin: '0 24px 24px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, overflowX: 'auto' }}>
        <div style={{ minWidth: 112 + 84 * mesa.meses.length }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: '1px solid var(--line)' }}>
            <div style={rotulo}>Sale en</div>
            {mesa.meses.map(m => (
              <div key={m.mes} style={{ padding: '10px 6px 8px', textAlign: 'center', borderLeft: '1px solid var(--line-soft)', background: m.esHoy ? 'var(--celeste-dim)' : 'transparent' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', textTransform: 'capitalize' }}>{nombreMes(m.mes).split(' ')[0].slice(0, 3)}</div>
                <div style={{ fontSize: 11, color: 'var(--t2)' }}>{m.mes.slice(0, 4)}</div>
                {m.esHoy && <div style={{ margin: '4px auto 0', width: 'fit-content', padding: '1px 8px', borderRadius: 9999, background: 'var(--celeste-deeper)', color: '#fff', fontSize: 10.5, fontWeight: 700 }}>Hoy</div>}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: cols, minHeight: 190 }}>
            <div style={{ padding: 12, fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>Salidas</div>
            {mesa.meses.map(m => {
              const d = destinos?.get(m.mes)
              const est = arrastrando && d ? ESTILO_SIM[d.estado] : null
              const acepta = !!arrastrando && !!d && d.estado !== 'gris'
              return (
                <div key={m.mes}
                  onDragOver={e => { if (acepta) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                  onDrop={e => { e.preventDefault(); if (acepta) soltar(m.mes) }}
                  style={{ padding: '8px 5px', borderLeft: '1px solid var(--line-soft)', display: 'flex', flexDirection: 'column', gap: 6, background: est ? est.bg : m.esHoy ? 'var(--celeste-dim)' : 'transparent', transition: 'background var(--t-fast)' }}>
                  {m.tarjetas.map(t => <Tarjeta key={t.id} t={t} arrastrada={arrastrando === t.id}
                    onDragStart={e => empezar(e, t)} onDragEnd={terminar}
                    onClick={() => { if (!t.fueraDelPlan) { seleccionarCliente(t.id); setVista('timeline') } }} />)}
                </div>
              )
            })}
          </div>

          {arrastrando && (
            <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '1px solid var(--line)' }}>
              <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: 'var(--celeste-deeper)', lineHeight: 1.3 }}>Si {nombreArrastrada} va a este mes</div>
              {mesa.meses.map(m => {
                const d = destinos?.get(m.mes)
                const e = d ? ESTILO_SIM[d.estado] : ESTILO_SIM.gris
                const txt = !d ? '…' : d.actual ? 'Está acá' : d.estado === 'verde' ? 'Entra' : d.estado === 'ambar' ? `Entra con avisos${d.motivo ? `: ${d.motivo}` : ''}` : (d.motivo ?? 'No entra').replace(/^No entra: /, '')
                return (
                  <div key={m.mes} style={{ padding: '6px 5px', borderLeft: '1px solid var(--line-soft)' }}>
                    <div title={txt} style={{ height: '100%', boxSizing: 'border-box', padding: '6px 6px', borderRadius: 8, background: e.bg, border: `1px solid ${e.bd}`, fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, color: e.tx, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>{txt}</div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div style={{ ...rotulo, gridColumn: '1 / -1', padding: '10px 12px 4px' }}>El equipo ese mes · % de su capacidad</div>
          </div>
          {mesa.equipo.map(p => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: cols, background: 'var(--paper)' }}>
              <div style={{ padding: '8px 12px', fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{p.alias}</div>
              {p.celdas.map(c => (
                <div key={c.mes} style={{ padding: '7px 8px', borderLeft: '1px solid var(--line-soft)' }}>
                  <div className="num" style={{ fontSize: 12.5, fontWeight: 700, color: c.pct != null && c.pct > 100 ? 'var(--error-tx)' : c.pct != null && c.pct >= 85 ? 'var(--warn-tx)' : 'var(--ink)' }}>{c.pct != null ? `${c.pct} %` : '—'}</div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ height: 6, width: `${Math.min(100, c.pct ?? 0)}%`, background: c.pct != null && c.pct > 100 ? 'var(--error)' : c.pct != null && c.pct >= 85 ? 'var(--warn)' : 'var(--viz-cierre)' }} />
                  </div>
                  {c.vacaciones && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vacaciones)', marginTop: 4 }}>{c.vacaciones}</div>}
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: cols, background: 'var(--paper)', borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ padding: '9px 12px 12px', fontSize: 13, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.2 }}>En paralelo<br /><span style={{ fontSize: 11, fontWeight: 500, color: 'var(--t2)' }}>tope {mesa.tope}</span></div>
            {mesa.meses.map(m => {
              const tope = m.paralelo >= mesa.tope, pasa = m.paralelo > mesa.tope
              return (
                <div key={m.mes} style={{ padding: '9px 8px 12px', borderLeft: '1px solid var(--line-soft)' }}>
                  {m.paralelo > 0 && <span className="num" title={`Máximo de cuentas abiertas a la vez un mismo día de ${nombreMes(m.mes).toLowerCase()}`} style={{ display: 'inline-block', minWidth: 30, textAlign: 'center', padding: '2px 6px', borderRadius: 9999, fontSize: 12, fontWeight: 800, background: pasa ? 'var(--error-bg)' : tope ? 'var(--warn-bg)' : 'var(--white)', border: `1.5px solid ${pasa ? 'var(--error)' : tope ? 'var(--warn)' : 'var(--celeste)'}`, color: pasa ? 'var(--error-tx)' : tope ? 'var(--warn-tx)' : 'var(--celeste-deeper)' }}>{m.paralelo}/{mesa.tope}</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <footer style={{ padding: '0 24px 24px', display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: 12, color: 'var(--t2)', alignItems: 'center' }}>
        {ETAPAS.map(e => (
          <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 5, borderRadius: 3, background: COLOR_ETAPA[e] }} />{e === 'Configuracion' ? 'Configuración' : e === 'Cierre' ? 'Actualización final' : e}</span>
        ))}
        <span>Tira gris = falta · media tira = en curso</span>
      </footer>
    </div>
  )
}

function Tarjeta({ t, arrastrada, onDragStart, onDragEnd, onClick }: {
  t: TarjetaSalida; arrastrada: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onClick: () => void
}) {
  const movible = !t.fueraDelPlan && !!t.movible
  const estilo: CSSProperties = {
    padding: '8px 8px 9px', borderRadius: 10, background: 'var(--white)', textAlign: 'left', width: '100%', boxSizing: 'border-box',
    border: t.fueraDelPlan ? '1px dashed var(--t3)' : arrastrada ? '2px solid var(--celeste)' : '1px solid var(--line)',
    boxShadow: arrastrada ? 'var(--sh)' : 'var(--sh-sm)', opacity: arrastrada ? 0.55 : 1,
    cursor: movible ? 'grab' : t.fueraDelPlan ? 'default' : 'pointer', font: 'inherit', color: 'inherit',
  }
  const titulo = t.fueraDelPlan ? 'Fuera del plan: ya estaba configurada'
    : movible ? 'Arrastrala a otro mes para cambiar su salida · clic para verla en el Timeline'
      : 'Ya arrancó: no se mueve sola · clic para verla en el Timeline'
  return (
    <button type="button" draggable={movible} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick} title={titulo} style={estilo}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.15 }}>{t.nombre}</div>
      <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 1 }}>{t.fueraDelPlan ? 'fuera del plan' : t.tier || 'sin tier'}</div>
      {t.etapas && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 2, margin: '7px 0 6px' }}>
          {ETAPAS.map(e => {
            const s = t.etapas![e]
            return <span key={e} style={{ height: 5, borderRadius: 3, background: s === 'hecha' ? COLOR_ETAPA[e] : s === 'en_curso' ? `linear-gradient(90deg, ${COLOR_ETAPA[e]} 50%, var(--line) 50%)` : 'var(--line)', opacity: s === 'no_tiene' ? 0.35 : 1 }} />
          })}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.3, marginTop: t.etapas ? 0 : 6 }}>{t.texto}</div>
    </button>
  )
}

const rotulo: CSSProperties = { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t2)', alignSelf: 'end' }
