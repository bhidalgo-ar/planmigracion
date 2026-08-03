import { useMemo, type CSSProperties } from 'react'
import { parseISO } from 'date-fns'
import { useSimuladorStore } from '../store'
import { formatFechaCorta } from '../utils/dates'

export function Insights() {
  const { personas, proyectos, asignaciones, violaciones } = useSimuladorStore()

  const data = useMemo(() => {
    const rojos = violaciones.filter(v => v.severidad === 'rojo').length
    const avisos = violaciones.filter(v => v.severidad === 'ambar').length

    // severidad por cuenta
    const sevPorAsig = new Map<string, 'rojo' | 'ambar'>()
    for (const v of violaciones) {
      if (v.severidad === 'rojo' || sevPorAsig.get(v.asignacion_id) !== 'rojo') sevPorAsig.set(v.asignacion_id, v.severidad)
    }
    const estadoCuenta = (pid: string): 'verde' | 'ambar' | 'rojo' => {
      const sevs = asignaciones.filter(a => a.proyecto_id === pid).map(a => sevPorAsig.get(a.id))
      return sevs.includes('rojo') ? 'rojo' : sevs.includes('ambar') ? 'ambar' : 'verde'
    }
    const estados = proyectos.map(p => estadoCuenta(p.id))
    const verdes = estados.filter(e => e === 'verde').length
    const ambarC = estados.filter(e => e === 'ambar').length
    const rojasC = estados.filter(e => e === 'rojo').length

    const noBloqueo = asignaciones.filter(a => !a.es_bloqueo)
    const entrega = noBloqueo.reduce<string | null>((m, a) => (!m || a.fin > m ? a.fin : m), null)

    // por regla
    const porRegla = { R2: 0, R3: 0 } as Record<'R2' | 'R3', number>
    for (const v of violaciones) porRegla[v.tipo]++

    // entregas por trimestre (fin de Pruebas, o última fase de la cuenta)
    const trimestres = new Map<string, number>()
    for (const p of proyectos) {
      const fases = asignaciones.filter(a => a.proyecto_id === p.id && !a.es_bloqueo)
      if (!fases.length) continue
      const fin = fases.reduce((m, a) => (a.fin > m ? a.fin : m), fases[0].fin)
      const d = parseISO(fin)
      const q = Math.floor(d.getMonth() / 3) + 1
      const key = `${d.getFullYear()} · T${q}`
      trimestres.set(key, (trimestres.get(key) ?? 0) + 1)
    }
    const entregasTrim = [...trimestres.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)

    // carga del equipo: semanas rojas (R2 rojo) + fases por persona
    const carga = personas.map(p => {
      const semRojas = violaciones.filter(v => v.tipo === 'R2' && v.severidad === 'rojo' && v.persona_id === p.id).length
      const nfases = asignaciones.filter(a => a.persona_id === p.id && !a.es_bloqueo).length
      return { alias: p.alias, semRojas, nfases }
    }).filter(c => c.nfases > 0).sort((a, b) => b.semRojas - a.semRojas || b.nfases - a.nfases)

    const enRiesgo = rojasC
    return { rojos, avisos, enRiesgo, entrega, verdes, ambarC, rojasC, porRegla, entregasTrim, carga, totalCuentas: proyectos.length, totalPersonas: personas.length }
  }, [personas, proyectos, asignaciones, violaciones])

  const maxRegla = Math.max(1, data.porRegla.R2, data.porRegla.R3)
  const maxTrim = Math.max(1, ...data.entregasTrim.map(([, n]) => n))
  const maxCarga = Math.max(1, ...data.carga.map(c => c.semRojas))

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, background: 'var(--lienzo)' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 22 }}>
        <Kpi label="Conflictos" valor={data.rojos} tono="error" />
        <Kpi label="Avisos" valor={data.avisos} tono="warn" />
        <Kpi label="Cuentas en riesgo" valor={`${data.enRiesgo}/${data.totalCuentas}`} tono={data.enRiesgo ? 'error' : 'ok'} />
        <Kpi label="Entrega estimada" valor={data.entrega ? formatFechaCorta(data.entrega) + ' ' + data.entrega.slice(0, 4) : '—'} />
        <Kpi label="Cuentas" valor={data.totalCuentas} />
        <Kpi label="Personas" valor={data.totalPersonas} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
        {/* Conflictos por regla */}
        <Card titulo="Conflictos por regla">
          {([
            ['R2', 'Sobreasignación', 'var(--error)'],
            ['R3', 'Dependencias', 'var(--warn)'],
          ] as const).map(([k, nombre, color]) => (
            <Barra key={k} label={`${k} · ${nombre}`} valor={data.porRegla[k]} max={maxRegla} color={color} />
          ))}
        </Card>

        {/* Cuentas por estado */}
        <Card titulo="Cuentas por estado">
          <div style={{ display: 'flex', gap: 10 }}>
            <EstadoChip label="OK" valor={data.verdes} color="var(--ok)" />
            <EstadoChip label="Atención" valor={data.ambarC} color="var(--warn)" />
            <EstadoChip label="Riesgo" valor={data.rojasC} color="var(--error)" />
          </div>
        </Card>

        {/* Entregas por trimestre */}
        <Card titulo="Entregas por trimestre">
          {data.entregasTrim.length === 0 ? <Vacio /> : data.entregasTrim.map(([k, n]) => (
            <Barra key={k} label={k} valor={n} max={maxTrim} color="var(--celeste)" />
          ))}
        </Card>

        {/* Carga del equipo */}
        <Card titulo="Carga del equipo (semanas sobreasignadas)">
          {data.carga.length === 0 ? <Vacio /> : data.carga.map(c => (
            <Barra key={c.alias} label={`${c.alias} · ${c.nfases} fases`} valor={c.semRojas} max={maxCarga} color={c.semRojas > 0 ? 'var(--error)' : 'var(--ok)'} />
          ))}
        </Card>
      </div>
    </div>
  )
}

function Kpi({ label, valor, tono }: { label: string; valor: string | number; tono?: 'error' | 'warn' | 'ok' }) {
  const color = tono === 'error' ? 'var(--error)' : tono === 'warn' ? 'var(--warn)' : tono === 'ok' ? 'var(--ok)' : 'var(--ink)'
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', boxShadow: 'var(--sh-sm)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div className="num" style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4, lineHeight: 1.1 }}>{valor}</div>
    </div>
  )
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-sm)' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{titulo}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{children}</div>
    </div>
  )
}

function Barra({ label, valor, max, color }: { label: string; valor: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--t2)', width: 130, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: 'var(--paper)', borderRadius: 9999, overflow: 'hidden' }}>
        <div style={{ width: `${(valor / max) * 100}%`, height: '100%', background: color, borderRadius: 9999, transition: 'width var(--t) var(--ease)' }} />
      </div>
      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', width: 26, textAlign: 'right' }}>{valor}</span>
    </div>
  )
}

function EstadoChip({ label, valor, color }: { label: string; valor: number; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 12, background: 'var(--paper)', border: `1.5px solid ${color}` }}>
      <div className="num" style={{ fontSize: 24, fontWeight: 800, color }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>{label}</div>
    </div>
  )
}

const Vacio = () => <span style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' } as CSSProperties}>Sin datos</span>
