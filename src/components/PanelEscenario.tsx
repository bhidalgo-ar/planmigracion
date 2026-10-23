import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import {
  compararPlanes, palancasDe, pasosEscalera, personasDeImplementacion, rearmarConPalancas, ultimaSalida,
  type Palancas, type PlanDatos,
} from '../escenario'
import type { ReporteAdelantar } from '../planificadorNivelado'
import { disponibilidadMes, horasDiaDe } from '../capacidad'
import { nombreMes } from '../rules'
import { mesCorto } from '../vistasPrograma'
import { toISO } from '../utils/dates'

const MAXIMO_PERMITIDO = 1.2

/** Meses de diferencia entre dos 'YYYY-MM' (b − a). */
function mesesEntreDos(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

/**
 * Panel del escenario arriba del Timeline (F, 23/10/2026): las palancas de capacidad, el botón
 * que rearma el calendario adelantando cuentas y qué aporta cada palanca por separado. Las
 * palancas se aplican en el momento (cambian la capacidad, no las fechas); "Rearmar" parte
 * siempre del plan con que se abrió el escenario.
 */
export function PanelEscenario() {
  const { personas, proyectos, asignaciones, config, escenarioBase, iniciarEscenario, setPalancas, rearmarConPalancas: rearmar } = useSimuladorStore()
  const { setPanelEscenario, setVista } = useUIStore()
  useEffect(() => { if (!escenarioBase) iniciarEscenario() }, [escenarioBase, iniciarEscenario])

  const actual: PlanDatos = useMemo(() => ({ personas, proyectos, asignaciones, config }), [personas, proyectos, asignaciones, config])
  const palancas = useMemo(() => palancasDe(actual), [actual])
  const base = escenarioBase ?? actual
  const palancasBase = useMemo(() => palancasDe(base), [base])
  const comp = useMemo(() => compararPlanes(base, actual), [base, actual])
  const ps = personasDeImplementacion(actual)
  const hoyISO = toISO(new Date())

  const [rearmando, setRearmando] = useState(false)
  const [reporte, setReporte] = useState<ReporteAdelantar | null>(null)
  const [escalera, setEscalera] = useState<Array<{ etiqueta: string; ultima: string | null; fin: string | null }> | null>(null)
  const [calculando, setCalculando] = useState<number | null>(null)
  // Si cambian las palancas, la escalera calculada ya no corresponde.
  useEffect(() => { setEscalera(null) }, [palancas.tope, JSON.stringify(palancas.horasDia), JSON.stringify(palancas.cargaMaxima)])

  function cambiar(p: Palancas) { setPalancas(p); setReporte(null) }
  function onRearmar() {
    setRearmando(true)
    setTimeout(() => { setReporte(rearmar(palancas)); setRearmando(false) }, 20)
  }
  function onEscalera() {
    const pasos = pasosEscalera(palancasBase, palancas, id => personas.find(p => p.id === id)?.alias ?? id)
    const out: Array<{ etiqueta: string; ultima: string | null; fin: string | null }> = []
    setCalculando(0)
    const uno = (i: number) => {
      if (i >= pasos.length) { setEscalera(out); setCalculando(null); return }
      const r = rearmarConPalancas(base, pasos[i].palancas, hoyISO)
      out.push({ etiqueta: pasos[i].etiqueta, ultima: ultimaSalida(r.plan), fin: r.plan.asignaciones.filter(a => !a.es_bloqueo).map(a => a.fin).sort().pop() ?? null })
      setCalculando(i + 1)
      setTimeout(() => uno(i + 1), 10)
    }
    setTimeout(() => uno(0), 20)
  }

  const ultBase = comp.ultimaSalida.antes, ultAhora = comp.ultimaSalida.despues
  const delta = ultBase && ultAhora ? mesesEntreDos(ultBase, ultAhora) : 0
  const picoAhora = comp.equipo.reduce<{ alias: string; pct: number; mes: string } | null>((a, e) => (e.pico.despues && (!a || e.pico.despues.pct > a.pct) ? { alias: e.alias, ...e.pico.despues } : a), null)
  const picoAntes = comp.equipo.reduce<{ alias: string; pct: number; mes: string } | null>((a, e) => (e.pico.antes && (!a || e.pico.antes.pct > a.pct) ? { alias: e.alias, ...e.pico.antes } : a), null)
  const pasosPosibles = pasosEscalera(palancasBase, palancas, id => id).length

  return (
    <section aria-label="Escenario de capacidad" style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 14px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', maxHeight: '46vh', overflowY: 'auto' }}>
      <div style={{ ...bloque, flex: '1 1 330px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={eyebrow}>Palancas</span>
          <button type="button" onClick={() => setPanelEscenario(false)} aria-label="Cerrar el panel del escenario" title="Cerrar el panel (el escenario sigue abierto)" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--t2)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 2 }}>×</button>
        </div>
        <Fila etiqueta="Cuentas abiertas a la vez" valor={`${palancas.tope}`} antes={palancasBase.tope !== palancas.tope ? `era ${palancasBase.tope}` : ''}
          onMenos={() => cambiar({ ...palancas, tope: Math.max(1, palancas.tope - 1) })} onMas={() => cambiar({ ...palancas, tope: Math.min(20, palancas.tope + 1) })} />
        {ps.map(p => {
          const propia = p.horas_dia != null || palancasBase.horasDia[p.id] != null
          const h = horasDiaDe(p, config)
          const hb = palancasBase.horasDia[p.id] ?? null
          const disp = disponibilidadMes(p.id, hoyISO.slice(0, 7), config, undefined, p)
          return propia ? (
            <Fila key={p.id} etiqueta={`Jornada de ${p.alias}`} valor={`${h} h`} antes={hb !== palancas.horasDia[p.id] ? `era ${hb ?? horasDiaDe(undefined, config)} h` : ''}
              onMenos={() => cambiar({ ...palancas, horasDia: { ...palancas.horasDia, [p.id]: Math.max(1, h - 1) } })}
              onMas={() => cambiar({ ...palancas, horasDia: { ...palancas.horasDia, [p.id]: Math.min(12, h + 1) } })} />
          ) : (
            <div key={p.id} style={{ fontSize: 12, color: 'var(--t2)' }} title="Su capacidad sale de la jornada del plan por su disponibilidad del mes. Para cambiarla, en ··· → Equipo.">
              {p.alias}: jornada del plan, {h} h × {Math.round(disp * 100)} % este mes
            </div>
          )
        })}
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>Pueden llegar al {Math.round(MAXIMO_PERMITIDO * 100)} % en una semana</legend>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {ps.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer' }}>
                <input type="checkbox" checked={(palancas.cargaMaxima[p.id] ?? 1) > 1}
                  onChange={e => cambiar({ ...palancas, cargaMaxima: { ...palancas.cargaMaxima, [p.id]: e.target.checked ? MAXIMO_PERMITIDO : 1 } })}
                  style={{ width: 16, height: 16, accentColor: 'var(--celeste-dark)' }} />
                {p.alias}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="button" onClick={onRearmar} disabled={rearmando}
          title="Parte del plan con que abriste el escenario, aplica estas palancas y adelanta cada cuenta que no arrancó al primer mes donde entra, en el orden de salida. Respeta tope de salidas, blackout, vacaciones, margen, 4 meses abierta y las reglas de diciembre."
          style={{ font: 'inherit', marginTop: 2, padding: '9px 14px', borderRadius: 10, border: '2px solid var(--celeste)', background: 'var(--celeste-dim)', color: 'var(--celeste-deeper)', fontSize: 13, fontWeight: 800, cursor: rearmando ? 'wait' : 'pointer' }}>
          {rearmando ? 'Rearmando…' : 'Rearmar el calendario con estas palancas'}
        </button>
      </div>

      <div style={{ ...bloque, flex: '2 1 420px' }}>
        <span style={eyebrow}>Cómo queda</span>
        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.25 }}>
          {!ultAhora ? 'Sin salidas en el plan.' : delta < 0 ? `La última cuenta sale en ${nombreMes(ultAhora).toLowerCase()}, ${-delta} mes${delta !== -1 ? 'es' : ''} antes.`
            : delta > 0 ? `La última cuenta sale en ${nombreMes(ultAhora).toLowerCase()}, ${delta} mes${delta !== 1 ? 'es' : ''} después.`
              : `La última cuenta sigue saliendo en ${nombreMes(ultAhora).toLowerCase()}.`}
        </div>
        <div className="num" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 12.5, color: 'var(--t1)' }}>
          <span>Fin {fecha(comp.fin.antes)} → <b>{fecha(comp.fin.despues)}</b></span>
          <span>Cuentas que cambian de mes <b>{comp.movidas.length}</b></span>
          <span>Pico {picoAntes ? `${picoAntes.pct} %` : '—'} → <b style={{ color: (picoAhora?.pct ?? 0) > 100 ? 'var(--error-tx)' : 'var(--ink)' }}>{picoAhora ? `${picoAhora.pct} % ${picoAhora.alias} en ${mesCorto(picoAhora.mes).toLowerCase()}` : '—'}</b></span>
          <span>Rojos {comp.rojos.antes} → <b style={{ color: comp.rojos.despues > comp.rojos.antes ? 'var(--error-tx)' : 'var(--ink)' }}>{comp.rojos.despues}</b></span>
          <span>Abiertas a la vez, máximo <b>{comp.paralelo.despues}</b> de {comp.paralelo.tope}</span>
        </div>
        {reporte && (
          <div style={{ fontSize: 12, color: 'var(--t1)', lineHeight: 1.45 }}>
            {reporte.movidas.length ? <>Adelantan: {reporte.movidas.map(m => `${m.nombre} ${mesCorto(m.antes).toLowerCase()} → ${mesCorto(m.despues).toLowerCase()}`).join(', ')}.</> : 'Ninguna cuenta entra antes con estas palancas.'}
            {reporte.noEntran.length > 0 && <span style={{ color: 'var(--warn-tx)' }}> No entran ni en su mes: {reporte.noEntran.map(n => `${n.nombre} (${n.motivo})`).join('; ')}.</span>}
          </div>
        )}
        <div><button type="button" onClick={() => setVista('comparar')} style={botonChico}>Ver la comparación completa</button></div>
      </div>

      <div style={{ ...bloque, flex: '1 1 300px' }}>
        <span style={eyebrow}>Qué aporta cada palanca</span>
        {escalera ? (
          <div>
            {escalera.map(e => {
              const d = ultBase && e.ultima ? mesesEntreDos(ultBase, e.ultima) : 0
              return (
                <div key={e.etiqueta} className="num" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '6px 0', borderTop: '1px solid var(--line-soft)', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--t1)' }}>{e.etiqueta}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: d < 0 ? 'var(--ok-tx)' : d > 0 ? 'var(--error-tx)' : 'var(--t2)', whiteSpace: 'nowrap' }}>{e.ultima ? mesCorto(e.ultima).toLowerCase() : '—'} · {d === 0 ? 'igual' : `${d > 0 ? '+' : '−'}${Math.abs(d)} mes${Math.abs(d) !== 1 ? 'es' : ''}`}</span>
                </div>
              )
            })}
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 4 }}>Última salida del programa rearmado con cada paso, desde el plan de partida ({ultBase ? mesCorto(ultBase).toLowerCase() : '—'}).</div>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.4 }}>Rearma el calendario con cada palanca por separado para ver cuál mueve el fin del programa. Tarda unos segundos por paso.</p>
            <div><button type="button" onClick={onEscalera} disabled={calculando !== null} style={botonChico}>{calculando !== null ? `Calculando ${calculando} de ${pasosPosibles}…` : `Calcular (${pasosPosibles} paso${pasosPosibles !== 1 ? 's' : ''})`}</button></div>
          </>
        )}
      </div>
    </section>
  )
}

function fecha(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—'
}

function Fila({ etiqueta, valor, antes, onMenos, onMas }: { etiqueta: string; valor: string; antes: string; onMenos: () => void; onMas: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--t1)' }}>{etiqueta}</span>
      <button type="button" aria-label={`Bajar: ${etiqueta}`} onClick={onMenos} style={paso}>−</button>
      <span className="num" style={{ minWidth: 64, textAlign: 'center', fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{valor}{antes && <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: 'var(--t2)' }}>{antes}</span>}</span>
      <button type="button" aria-label={`Subir: ${etiqueta}`} onClick={onMas} style={paso}>+</button>
    </div>
  )
}

const bloque: CSSProperties = { minWidth: 0, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--celeste-deeper)' }
const paso: CSSProperties = { font: 'inherit', width: 28, height: 28, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t1)', fontSize: 15, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: 0 }
const botonChico: CSSProperties = { font: 'inherit', padding: '6px 12px', borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t1)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
