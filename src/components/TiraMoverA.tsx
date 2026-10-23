import { useMemo, useState } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { mesesCandidatos, planificarCuenta, simularDestinos, simularDestinosNivelado, type Destino } from '../planificador'
import { planificarCuentaNivelada } from '../planificadorNivelado'
import { ddmm, nombreMes } from '../rules'
import { toISO } from '../utils/dates'

const ESTILO: Record<Destino['estado'], { bg: string; bd: string; tx: string }> = {
  verde: { bg: 'var(--ok-bg)', bd: 'var(--ok-bd)', tx: 'var(--ok-tx)' },
  ambar: { bg: 'var(--warn-bg)', bd: 'var(--warn-bd)', tx: 'var(--warn-tx)' },
  rojo: { bg: 'var(--error-bg)', bd: 'var(--error-bd)', tx: 'var(--error-tx)' },
  gris: { bg: 'var(--line-soft)', bd: 'var(--line)', tx: 'var(--t3)' },
}

export const TIRA_H = 58

/**
 * La tira "Mover a" de la vista D (23/10/2026): debajo de la cuenta seleccionada en el Timeline,
 * un botón por mes, alineado con el eje, pintado según qué pasaría si la cuenta saliera ese mes.
 * Es la misma simulación que la tira "Sale en vivo" del panel; al pasar el mouse se ven las fases
 * fantasma en el Gantt y al hacer clic la cuenta se mueve. Así se ve qué entra y qué no sin
 * abrir el panel lateral.
 */
export function TiraMoverA({ proyectoId, top, posicion }: {
  proyectoId: string
  top: number
  /** x y ancho del mes en el eje del Timeline; null si el mes no está en el eje. */
  posicion: (mes: string) => { x: number; w: number } | null
}) {
  const { asignaciones, personas, config, proyectos, moverCuentaAMes } = useSimuladorStore()
  const { respetarCapacidad, setPrevisualizacion, setUltimoMovimiento } = useUIStore()
  const [aviso, setAviso] = useState<string | null>(null)
  const hoyISO = toISO(new Date())
  const meses = useMemo(() => mesesCandidatos(config, hoyISO), [config, hoyISO])
  const destinos = useMemo(
    () => (respetarCapacidad
      ? simularDestinosNivelado(proyectoId, meses, asignaciones, personas, config, proyectos, hoyISO)
      : simularDestinos(proyectoId, meses, asignaciones, personas, config, proyectos)),
    [respetarCapacidad, proyectoId, meses, asignaciones, personas, config, proyectos, hoyISO],
  )
  const nombre = proyectos.find(p => p.id === proyectoId)?.nombre ?? proyectoId

  function previsualizar(mes: string) {
    if (respetarCapacidad) {
      const niv = planificarCuentaNivelada(proyectoId, asignaciones, mes, personas, config, proyectos, { hoyISO })
      if (niv.ok) { setPrevisualizacion({ proyectoId, asignaciones: niv.asignaciones }); return }
    }
    const plan = planificarCuenta(proyectoId, asignaciones, mes, config)
    setPrevisualizacion(plan.ok ? { proyectoId, asignaciones: plan.asignaciones } : null)
  }
  function elegir(d: Destino) {
    setPrevisualizacion(null)
    if (d.actual || d.estado === 'gris') return
    const r = moverCuentaAMes(proyectoId, d.mes, respetarCapacidad)
    if (!r.ok) { setAviso(r.motivo ?? 'No se pudo mover.'); return }
    setUltimoMovimiento(r.reporte ?? null)
    const rep = r.reporte
    setAviso(rep ? `${nombre}: ${rep.mesAntes ? nombreMes(rep.mesAntes).toLowerCase() : 'sin mes'} → ${nombreMes(rep.mesDespues).toLowerCase()} · conflictos ${rep.rojosAntes} → ${rep.rojosDespues}${rep.noEntra ? ` · no entra respetando capacidad: ${rep.noEntra}` : ''}` : null)
  }

  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, height: TIRA_H, zIndex: 6, pointerEvents: 'none' }}>
      {destinos.map(d => {
        const pos = posicion(d.mes)
        if (!pos || pos.w < 6) return null
        const e = d.actual ? { bg: 'var(--ink)', bd: 'var(--ink)', tx: 'var(--white)' } : ESTILO[d.estado]
        const motivo = d.actual ? `Sale acá · corte ${d.corte ? ddmm(d.corte) : '—'}` : d.estado === 'verde' ? `Entra${d.corte ? ` · corte ${ddmm(d.corte)}` : ''}` : (d.motivo ?? '').replace(/^No entra: /, 'No entra: ')
        const corto = pos.w >= 64 ? nombreMes(d.mes).split(' ')[0].slice(0, 3) : ''
        const signo = d.actual ? '●' : d.estado === 'verde' ? '✓' : d.estado === 'ambar' ? '!' : '✕'
        return (
          <button key={d.mes} type="button" disabled={d.estado === 'gris'} title={`${nombreMes(d.mes)}: ${motivo}`}
            onMouseEnter={() => !d.actual && d.estado !== 'gris' && previsualizar(d.mes)}
            onMouseLeave={() => setPrevisualizacion(null)}
            onMouseDown={ev => ev.stopPropagation()}
            onClick={ev => { ev.stopPropagation(); elegir(d) }}
            style={{
              position: 'absolute', left: pos.x + 2, width: pos.w - 4, top: 8, height: 30, boxSizing: 'border-box', pointerEvents: 'auto',
              borderRadius: 8, border: `1.5px solid ${e.bd}`, background: e.bg, color: e.tx, font: 'inherit', fontSize: 11.5, fontWeight: 800,
              cursor: d.actual || d.estado === 'gris' ? 'default' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', padding: 0,
            }}>
            {corto ? `${corto} ${signo}` : signo}
          </button>
        )
      })}
      {aviso && (
        <div className="num" style={{ position: 'absolute', top: 40, left: Math.min(...destinos.map(d => posicion(d.mes)?.x ?? Infinity)) + 4, right: 8, fontSize: 11, fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{aviso}</div>
      )}
    </div>
  )
}
