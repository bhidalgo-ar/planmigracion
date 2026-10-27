import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSimuladorStore } from '../store'
import type { TipoFase } from '../types'
import { TIPO_COLOR, TIPO_LABEL } from '../theme/fases'
import { diasDeVacaciones } from '../capacidad'
import { faseDeCuenta, horasPorPersona, repartoAMano, repartoParejo, repartoPlantilla } from '../fases'
import { diasHabiles, feriadosDeConfig } from '../utils/dates'

export const RECUADRO_W = 340

/** Dónde está la fase en la pantalla: el recuadro va debajo y, si no entra, arriba. */
export interface AnclaRecuadro { left: number; arriba: number; abajo: number }

type Modo = 'plantilla' | 'parejo' | 'mano'

const fmtH = (h: number) => `${(Math.round(h * 100) / 100).toLocaleString('es-AR')} h`
const iguales = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).every(k => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.01)

/**
 * El recuadro de una fase (23/10/2026, una barra por fase): se abre con clic en la fase de una
 * cuenta en el Timeline. Cambia las fechas de toda la fase, cómo se reparten sus horas entre
 * quienes la hacen (como la plantilla, mitad y mitad o a mano; el total nunca cambia) y el 📌,
 * que hace que el planificador conserve su duración. Nada se aplica hasta "Aplicar".
 */
export function RecuadroFase({ proyectoId, tipo, ancla, onClose }: {
  proyectoId: string
  tipo: TipoFase
  ancla: AnclaRecuadro
  onClose: () => void
}) {
  const caja = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: ancla.left, top: ancla.abajo + 6 })
  useLayoutEffect(() => {
    const h = caja.current?.offsetHeight ?? 0
    const left = Math.max(8, Math.min(ancla.left, window.innerWidth - RECUADRO_W - 8))
    let top = ancla.abajo + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, Math.min(ancla.arriba - h - 6, window.innerHeight - h - 8))
    setPos({ left, top })
  }, [ancla])
  const { asignaciones, personas, proyectos, config, editarFaseCuenta } = useSimuladorStore()
  const feriados = useMemo(() => feriadosDeConfig(config), [config])
  const fase = useMemo(() => faseDeCuenta(asignaciones, proyectoId, tipo), [asignaciones, proyectoId, tipo])
  const inicial = useMemo(() => (fase ? horasPorPersona(fase, personas, config) : {}), [fase, personas, config])
  const [inicio, setInicio] = useState(fase?.inicio ?? '')
  const [fin, setFin] = useState(fase?.fin ?? '')
  const [horas, setHoras] = useState<Record<string, number>>(inicial)
  const [fijada, setFijada] = useState(!!fase?.fijada)
  const [modo, setModo] = useState<Modo>(() => {
    if (!fase) return 'plantilla'
    if (iguales(inicial, repartoPlantilla(fase, inicial))) return 'plantilla'
    if (iguales(inicial, repartoParejo(inicial))) return 'parejo'
    return 'mano'
  })

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  if (!fase) return null
  const nombre = proyectos.find(p => p.id === proyectoId)?.nombre ?? proyectoId
  const aliasDe = (pid: string) => personas.find(p => p.id === pid)?.alias ?? pid
  const fechasOk = !!inicio && !!fin && fin >= inicio
  const habiles = fechasOk ? diasHabiles(inicio, fin, feriados) : 0
  const total = Object.values(horas).reduce((s, h) => s + h, 0)
  const varias = fase.barras.length > 1
  const fechasTocadas = inicio !== fase.inicio || fin !== fase.fin
  /**
   * Días que trabaja cada uno: en sus propias fechas mientras no se toquen (el planificador puede
   * dejar que una persona termine antes que otra) y, si se tocan, en las de la fase para todos.
   * Sus vacaciones adentro son hueco. Devuelve también los hábiles del rango, para avisar el hueco.
   */
  const diasQueTrabaja = (b: { persona_id: string; inicio: string; fin: string }) => {
    if (!fechasOk) return { dias: 0, rango: 0 }
    const [i0, i1] = fechasTocadas ? [inicio, fin] : [b.inicio, b.fin]
    const rango = diasHabiles(i0, i1, feriados)
    const vac = diasDeVacaciones(b.persona_id, asignaciones, feriados)
    let n = 0
    for (const iso of vac) if (iso >= i0 && iso <= i1) n++
    return { dias: Math.max(0, rango - n) || rango, rango }
  }

  function elegirModo(m: Modo) {
    setModo(m)
    if (m === 'plantilla') setHoras(repartoPlantilla(fase!, horas))
    if (m === 'parejo') setHoras(repartoParejo(horas))
  }
  function cambiarFecha(cual: 'inicio' | 'fin', v: string) {
    if (cual === 'inicio') setInicio(v); else setFin(v)
    setFijada(true)
  }
  function aplicar() {
    if (!fechasOk) return
    editarFaseCuenta(proyectoId, tipo, { inicio, fin, horas, fijada })
    onClose()
  }

  const inp: React.CSSProperties = { font: 'inherit', fontSize: 12.5, fontWeight: 700, border: '1px solid var(--line)', borderRadius: 8, padding: '5px 8px', background: 'var(--paper)', color: 'var(--t1)' }
  const seg = (on: boolean): React.CSSProperties => ({
    font: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '5px 9px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--celeste)' : 'var(--line)'}`, background: on ? 'var(--celeste-dim)' : 'var(--white)', color: on ? 'var(--celeste-deeper)' : 'var(--t2)',
  })

  return (
    <div role="dialog" aria-label={`${TIPO_LABEL[tipo]} de ${nombre}`} ref={caja}
      onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: RECUADRO_W, zIndex: 60, boxSizing: 'border-box', padding: '12px 14px',
        background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--sh-celeste)', cursor: 'default', color: 'var(--t1)',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: TIPO_COLOR[tipo], flexShrink: 0 }} />
        <b style={{ fontSize: 13.5 }}>{TIPO_LABEL[tipo]} · {nombre}</b>
        <button type="button" onClick={onClose} aria-label="Cerrar" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--t3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 11, marginBottom: 10 }}>
        <span style={{ color: 'var(--t2)', fontWeight: 700 }}>Desde</span>
        <span style={{ color: 'var(--t2)', fontWeight: 700 }}>Hasta</span>
        <input type="date" value={inicio} onChange={e => cambiarFecha('inicio', e.target.value)} style={{ ...inp, minWidth: 0 }} aria-label="Desde" />
        <input type="date" value={fin} min={inicio} onChange={e => cambiarFecha('fin', e.target.value)} style={{ ...inp, minWidth: 0 }} aria-label="Hasta" />
        <span className="num" style={{ gridColumn: '1 / -1', fontSize: 11.5, color: fechasOk ? 'var(--t2)' : 'var(--error-tx)' }}>{fechasOk ? `${habiles} día${habiles !== 1 ? 's' : ''} hábil${habiles !== 1 ? 'es' : ''}` : 'Revisá las fechas: termina antes de empezar.'}</span>
      </div>

      <table className="num" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: 'var(--t2)', fontSize: 11 }}>
            <th style={{ textAlign: 'left', fontWeight: 700, padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}>Quién</th>
            <th style={{ textAlign: 'right', fontWeight: 700, padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}>Horas</th>
            <th style={{ textAlign: 'right', fontWeight: 700, padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}>Por día</th>
          </tr>
        </thead>
        <tbody>
          {fase.barras.map(b => {
            const h = horas[b.persona_id] ?? 0
            const { dias, rango } = diasQueTrabaja(b)
            return (
              <tr key={b.persona_id}>
                <td style={{ padding: '5px 0', borderBottom: '1px solid var(--line-soft)' }}>{aliasDe(b.persona_id)}</td>
                <td style={{ padding: '5px 0', borderBottom: '1px solid var(--line-soft)', textAlign: 'right' }}>
                  {varias
                    ? <input type="number" min={0} step={0.5} value={Math.round(h * 100) / 100} aria-label={`Horas de ${aliasDe(b.persona_id)}`}
                        onChange={e => { setModo('mano'); setHoras(repartoAMano(horas, b.persona_id, Number(e.target.value) || 0)) }}
                        style={{ ...inp, width: 74, textAlign: 'right', padding: '3px 6px' }} />
                    : fmtH(h)}
                </td>
                <td style={{ padding: '5px 0', borderBottom: '1px solid var(--line-soft)', textAlign: 'right', color: 'var(--t2)' }}>
                  {dias ? fmtH(h / dias) : '—'}
                  {dias && dias < rango ? <div title="Tiene vacaciones adentro de la fase: esos días no lleva horas" style={{ fontSize: 10.5, color: 'var(--vacaciones)' }}>en {dias} días, sin sus vacaciones</div> : null}
                </td>
              </tr>
            )
          })}
          <tr>
            <td style={{ padding: '5px 0', color: 'var(--t2)' }}>Total</td>
            <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 800 }}>{fmtH(total)}</td>
            <td />
          </tr>
        </tbody>
      </table>

      {varias && (
        <>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', margin: '6px 0 4px' }}>
            {fase.barras.map((b, i) => (
              <div key={b.persona_id} style={{ width: `${total > 0 ? ((horas[b.persona_id] ?? 0) / total) * 100 : 0}%`, background: TIPO_COLOR[tipo], opacity: i % 2 ? 1 : 0.5 }} />
            ))}
          </div>
          <div className="num" style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 8 }}>
            {fase.barras.map(b => `${aliasDe(b.persona_id)} ${total > 0 ? Math.round(((horas[b.persona_id] ?? 0) / total) * 100) : 0} %`).join(' · ')}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button type="button" style={seg(modo === 'plantilla')} onClick={() => elegirModo('plantilla')}>Como la plantilla</button>
            <button type="button" style={seg(modo === 'parejo')} onClick={() => elegirModo('parejo')}>{fase.barras.length === 2 ? 'Mitad y mitad' : 'Partes iguales'}</button>
            <button type="button" style={seg(modo === 'mano')} onClick={() => elegirModo('mano')}>A mano</button>
          </div>
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.4, margin: '4px 0 12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={fijada} onChange={e => setFijada(e.target.checked)} style={{ marginTop: 2 }} />
        <span><b>📌 Mantener estos días.</b> Si rearmás el calendario o movés la cuenta de mes, esta fase conserva su duración.</span>
      </label>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 800, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t1)', cursor: 'pointer' }}>Cancelar</button>
        <button type="button" onClick={aplicar} disabled={!fechasOk} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 800, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--white)', cursor: fechasOk ? 'pointer' : 'not-allowed', opacity: fechasOk ? 1 : 0.5 }}>Aplicar</button>
      </div>
    </div>
  )
}
