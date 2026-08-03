import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { formatFecha, formatFechaCorta } from '../utils/dates'

const REGLA_NOMBRE: Record<'R2' | 'R3', string> = {
  R2: 'Sobreasignación de personas', R3: 'Dependencias fuera de orden',
}

export function ResumenEjecutivo() {
  const { proyectos, asignaciones, personas, violaciones, config } = useSimuladorStore()
  const setResumen = useUIStore(s => s.setResumen)
  const [copiado, setCopiado] = useState(false)
  const copiadoTimer = useRef<number>()
  useEffect(() => () => { if (copiadoTimer.current) clearTimeout(copiadoTimer.current) }, [])

  const d = useMemo(() => {
    const rojos = violaciones.filter(v => v.severidad === 'rojo')
    const avisos = violaciones.filter(v => v.severidad === 'ambar')
    const sevPorAsig = new Map<string, 'rojo' | 'ambar'>()
    for (const v of violaciones) if (v.severidad === 'rojo' || sevPorAsig.get(v.asignacion_id) !== 'rojo') sevPorAsig.set(v.asignacion_id, v.severidad)

    const cuentas = proyectos.map(p => {
      const fases = asignaciones.filter(a => a.proyecto_id === p.id && !a.es_bloqueo)
      const desde = fases.reduce<string | null>((m, a) => (!m || a.inicio < m ? a.inicio : m), null)
      const entrega = fases.reduce<string | null>((m, a) => (!m || a.fin > m ? a.fin : m), null)
      const sevs = asignaciones.filter(a => a.proyecto_id === p.id).map(a => sevPorAsig.get(a.id))
      const estado: 'verde' | 'ambar' | 'rojo' = sevs.includes('rojo') ? 'rojo' : sevs.includes('ambar') ? 'ambar' : 'verde'
      return { p, desde, entrega, estado }
    }).sort((a, b) => (a.desde ?? 'z') < (b.desde ?? 'z') ? -1 : 1)

    const enRiesgo = cuentas.filter(c => c.estado === 'rojo').length
    const entregaMax = asignaciones.filter(a => !a.es_bloqueo).reduce<string | null>((m, a) => (!m || a.fin > m ? a.fin : m), null)

    const porRegla: Record<'R2' | 'R3', string[]> = { R2: [], R3: [] }
    for (const v of violaciones) porRegla[v.tipo].push(v.mensaje)

    return { rojos: rojos.length, avisos: avisos.length, enRiesgo, entregaMax, cuentas, porRegla }
  }, [proyectos, asignaciones, personas, violaciones])

  const transicion = config.fechas_clave.transicion_susana_toyota
  const transTexto = transicion ? formatFecha(transicion) : 'sin definir'
  const hoy = format(new Date(), "d 'de' MMMM yyyy", { locale: es })

  function textoPlano(): string {
    const L: string[] = []
    L.push('SIMULADOR DE MIGRACIÓN Meta4 → Axton — Resumen ejecutivo')
    L.push(`Hidalgo & Asociados · ${hoy}`, '')
    L.push(`Conflictos: ${d.rojos}  |  Avisos: ${d.avisos}  |  Cuentas en riesgo: ${d.enRiesgo}/${d.cuentas.length}  |  Entrega estimada: ${d.entregaMax ? formatFecha(d.entregaMax) : '—'}`)
    L.push(`Transición Susi → Toyota: ${transTexto}`, '')
    L.push('RIESGOS')
    let huboRiesgo = false
    for (const k of ['R3', 'R2'] as const) {
      if (!d.porRegla[k].length) continue
      huboRiesgo = true
      L.push(`· ${REGLA_NOMBRE[k]}:`)
      for (const m of d.porRegla[k]) L.push(`   - ${m}`)
    }
    if (!huboRiesgo) L.push('· Sin conflictos detectados.')
    L.push('', 'CUENTAS')
    for (const c of d.cuentas) {
      L.push(`· ${c.p.nombre} — ${c.estado.toUpperCase()} — desde ${c.desde ? formatFechaCorta(c.desde) : 's/d'} — entrega ${c.entrega ? formatFechaCorta(c.entrega) : 's/d'}`)
    }
    return L.join('\n')
  }

  async function copiar() {
    const txt = textoPlano()
    try {
      await navigator.clipboard.writeText(txt)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = txt; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
    }
    setCopiado(true)
    if (copiadoTimer.current) clearTimeout(copiadoTimer.current)
    copiadoTimer.current = window.setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <div className="reporte-overlay" onClick={() => setResumen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,19,30,0.55)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '24px 16px' }}>
      {/* Chrome (no se imprime) */}
      <div className="reporte-chrome" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={copiar} style={btn}>{copiado ? '✓ Copiado' : '📋 Copiar para mail'}</button>
        <button onClick={() => window.print()} style={{ ...btn, background: 'var(--celeste)', color: '#fff', border: 'none' }}>🖨 Imprimir / Guardar PDF</button>
        <button onClick={() => setResumen(false)} style={btn}>Cerrar</button>
      </div>

      {/* Hoja A4 */}
      <div id="reporte-print" onClick={e => e.stopPropagation()}
        style={{ width: 794, maxWidth: '100%', background: '#fff', color: '#1E3A5F', fontFamily: 'var(--font-report)', padding: '40px 48px', borderRadius: 4, boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        {/* Encabezado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: '3px solid #00ACD4', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#00ACD4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>H&A</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#15263D' }}>Simulador de Migración Meta4 → Axton</div>
            <div style={{ fontSize: 13, color: '#4A6080' }}>Hidalgo &amp; Asociados · Resumen ejecutivo</div>
          </div>
          <div style={{ fontSize: 12, color: '#8FA3BA' }}>{hoy}</div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
          <RKpi label="Conflictos" valor={d.rojos} color="#E85518" />
          <RKpi label="Avisos" valor={d.avisos} color="#F59E0B" />
          <RKpi label="Cuentas en riesgo" valor={`${d.enRiesgo}/${d.cuentas.length}`} color={d.enRiesgo ? '#E85518' : '#22C55E'} />
          <RKpi label="Entrega estimada" valor={d.entregaMax ? formatFechaCorta(d.entregaMax) + " '" + d.entregaMax.slice(2, 4) : '—'} color="#00ACD4" />
        </div>

        <div style={{ fontSize: 13, marginBottom: 22, padding: '8px 12px', background: '#EEF2F7', borderRadius: 6 }}>
          <strong>Transición Susi → Toyota:</strong> {transTexto}
        </div>

        {/* Riesgos */}
        <h3 style={hTitle}>Riesgos detectados</h3>
        {(['R3', 'R2'] as const).every(k => d.porRegla[k].length === 0) ? (
          <p style={{ fontSize: 13, color: '#22C55E', margin: '0 0 22px' }}>✓ Sin conflictos detectados con la configuración actual.</p>
        ) : (
          <div style={{ marginBottom: 22 }}>
            {(['R3', 'R2'] as const).map(k => d.porRegla[k].length > 0 && (
              <div key={k} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#15263D', marginBottom: 4 }}>{REGLA_NOMBRE[k]} <span style={{ color: '#8FA3BA', fontWeight: 400 }}>({d.porRegla[k].length})</span></div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {d.porRegla[k].slice(0, 12).map((m, i) => <li key={i} style={{ fontSize: 12, color: '#4A6080', lineHeight: 1.6 }}>{m}</li>)}
                  {d.porRegla[k].length > 12 && <li style={{ fontSize: 12, color: '#8FA3BA' }}>… y {d.porRegla[k].length - 12} más</li>}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Tabla de cuentas */}
        <h3 style={hTitle}>Cuentas ({d.cuentas.length})</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E7E6E6', textAlign: 'left' }}>
              <th style={th}>Cuenta</th><th style={th}>Estado</th><th style={th}>Desde</th><th style={th}>Entrega est.</th>
            </tr>
          </thead>
          <tbody>
            {d.cuentas.map(c => (
              <tr key={c.p.id} style={{ borderBottom: '1px solid #EEF2F7' }}>
                <td style={td}>{c.p.nombre}{c.p.especial ? ' · TASA' : ''}{c.p.quick_win ? ' · QW' : ''}</td>
                <td style={td}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6, background: c.estado === 'verde' ? '#22C55E' : c.estado === 'ambar' ? '#F59E0B' : '#E85518' }} />
                  {c.estado === 'verde' ? 'OK' : c.estado === 'ambar' ? 'Atención' : 'Riesgo'}
                </td>
                <td style={td}>{c.desde ? formatFechaCorta(c.desde) : '—'}</td>
                <td style={td}>{c.entrega ? formatFechaCorta(c.entrega) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid #E7E6E6', fontSize: 10.5, color: '#8FA3BA' }}>
          Generado por el Simulador de Migración · Planificación previa (la fuente de ejecución sigue siendo Monday) · {hoy}
        </div>
      </div>
    </div>
  )
}

function RKpi({ label, valor, color }: { label: string; valor: string | number; color: string }) {
  return (
    <div style={{ border: '1px solid #E7E6E6', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#4A6080', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 2 }}>{valor}</div>
    </div>
  )
}

const btn: CSSProperties = { padding: '8px 16px', border: '1.5px solid var(--line)', borderRadius: 9999, background: 'var(--white)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }
const hTitle: CSSProperties = { fontSize: 15, fontWeight: 700, color: '#15263D', margin: '0 0 10px' }
const th: CSSProperties = { padding: '6px 8px', fontSize: 11, color: '#4A6080', fontWeight: 700 }
const td: CSSProperties = { padding: '6px 8px', color: '#1E3A5F' }
