import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { parseISO } from 'date-fns'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { formatFecha, formatFechaCorta, toISO } from '../utils/dates'
import { ORDEN_FASES, TIPO_LABEL } from '../theme/fases'
import type { TipoFase } from '../types'
import {
  cargaPorPersona, cuentasFueraDelPlan, cuentasMigracion, migracionPorTrimestre, resumenMigracion,
  type CuentaMigracion,
} from '../insightsMigracion'

/** Color de gráfico por fase. Paso propio para marcas finas (ver --viz-* en index.css). */
const VIZ_FASE: Record<TipoFase, string> = {
  Relevamiento: 'var(--viz-relev)',
  Configuracion: 'var(--viz-config)',
  Pruebas: 'var(--viz-vivo)',
  Vacaciones: 'var(--fase-bloqueo)',
}

/**
 * Vista Insights: cómo avanza la migración de Meta 4 a Axton.
 *
 * Responde tres preguntas y nada más: cuándo sale cada cuenta a producción, cuántas
 * cuentas quedan en Meta 4 en cada trimestre, y quién hace qué. Los conflictos de
 * capacidad NO viven acá: para eso está el resaltado del timeline y el chip de la
 * barra superior, que están siempre a la vista.
 */
export function Insights() {
  const { personas, proyectos, asignaciones, config } = useSimuladorStore()
  const seleccionarCliente = useSimuladorStore(s => s.seleccionarCliente)
  const setVista = useUIStore(s => s.setVista)

  const hoyISO = toISO(new Date())
  const legacy = config.cartera_legacy_axton?.cuentas ?? []
  const overrideIds = config.cartera_legacy_axton?.cuentas_programa_ya_en_vivo ?? []
  const legacyCount = legacy.length
  const overrideKey = overrideIds.join('|')

  const d = useMemo(() => {
    // El mes de salida sale del plan (config.salidas_en_vivo_propuestas). POF y Finadiet
    // salen en vivo sin fases en el simulador: cuentan en trimestres y en la cartera.
    const cuentas = cuentasMigracion(proyectos, asignaciones, config)
    const fuera = cuentasFueraDelPlan(config)
    const todas = [...cuentas, ...fuera]
    return {
      cuentas,
      fuera,
      trimestres: migracionPorTrimestre(todas),
      carga: cargaPorPersona(personas, cuentas),
      r: resumenMigracion(todas, hoyISO, new Set(overrideIds)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personas, proyectos, asignaciones, config, hoyISO, overrideKey])

  function irACuenta(id: string) {
    seleccionarCliente(id)
    setVista('timeline')
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 24, background: 'var(--lienzo)' }}>
      {/* ── Encabezado: el número que manda ────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Hero
          label="Migración completa"
          valor={d.r.ultimaSalida ? formatFecha(d.r.ultimaSalida) : '—'}
          nota={d.r.ultimaSalida
            ? `${d.r.mesesPrograma ?? '?'} meses de programa · cierra ${d.r.cuentaCierre ?? '—'}`
            : 'Todavía no hay cuentas planificadas.'}
          alerta={d.r.sinPlanificar > 0
            ? `No incluye ${d.r.sinPlanificar} cuenta${d.r.sinPlanificar !== 1 ? 's' : ''} sin planificar`
            : null}
        />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 14 }}>
          <Kpi label="Cuentas del programa" valor={d.cuentas.length}
            nota={[
              d.r.sinPlanificar ? `${d.r.planificadas - d.fuera.length} planificadas` : 'todas planificadas',
              d.fuera.length ? `+ ${d.fuera.length} fuera del simulador` : '',
            ].filter(Boolean).join(' · ')} />
          <Kpi label="Cartera en Axton hoy" valor={`${legacyCount + d.r.enVivoHoy}/${legacyCount + d.r.totalCuentas}`}
            nota={`${legacyCount} legacy + ${d.r.enVivoHoy} salida${d.r.enVivoHoy !== 1 ? 's' : ''} en vivo${d.fuera.length ? ' (incluye fuera del simulador)' : ''}`} />
          <Kpi label="Primera salida del programa" valor={d.r.primeraSalida ? formatFechaCorta(d.r.primeraSalida) : '—'}
            nota={d.r.primeraSalida ? `año ${d.r.primeraSalida.slice(0, 4)}` : ''} />
          <Kpi label="Arranque del plan" valor={d.r.inicioPrograma ? formatFechaCorta(d.r.inicioPrograma) : '—'}
            nota={d.r.inicioPrograma ? `año ${d.r.inicioPrograma.slice(0, 4)}` : ''} />
        </div>
      </div>

      {/* ── Fila media: avance por trimestre + reparto del equipo ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 18, marginBottom: 18 }}>
        <TrimestresCard trimestres={d.trimestres} totalPrograma={d.r.totalCuentas} legacyCount={legacyCount} />
        <EquipoCard carga={d.carga} />
      </div>

      {/* ── Abajo, a lo ancho: la ola ──────────────────────────────────────── */}
      <OlaCard cuentas={d.cuentas} hoyISO={hoyISO} onCuenta={irACuenta} />
    </div>
  )
}

// ══ Trimestres ════════════════════════════════════════════════════════════════

/**
 * Columnas apiladas: foto al cierre de cada trimestre, en DOS bloques nada más —
 * cuántas cuentas están del lado Axton y cuántas siguen del lado Meta 4. Cada bloque
 * lleva su total adentro, así la comparación es directa y no hay que sumar a ojo.
 *
 * Antes esto tenía cuatro tramos (legacy / migradas / en migración / sin empezar) con
 * dos verdes casi iguales, y el "+N del trimestre" flotaba suelto arriba de la columna:
 * era ilegible. Ahora:
 *  - la cartera legacy no es un tramo propio (es constante, va en el subtítulo y en el
 *    tooltip: un número que no cambia no necesita repetirse seis veces);
 *  - "en migración" pasa al tooltip y a la tabla, que es donde se buscan detalles;
 *  - las migradas EN el trimestre se marcan con un CORCHETE al costado del pedazo de
 *    verde que les corresponde, en vez de con un color más.
 */
function TrimestresCard({ trimestres, totalPrograma, legacyCount }: {
  trimestres: ReturnType<typeof migracionPorTrimestre>; totalPrograma: number; legacyCount: number
}) {
  const [tabla, setTabla] = useState(false)
  const PLOT_H = 190
  const COL_W = 30
  const total = totalPrograma + legacyCount

  if (!trimestres.length) {
    return (
      <Card titulo="Meta 4 → Axton, trimestre a trimestre">
        <Vacio>Planificá al menos una cuenta para ver el avance por trimestre.</Vacio>
      </Card>
    )
  }

  const escala = (n: number) => (total > 0 ? (n / total) * PLOT_H : 0)
  // Ticks en números redondos, no en fracciones del total (0 / 9 / 17 se lee mal).
  const paso = total <= 6 ? 1 : total <= 12 ? 2 : 5
  const ticks: number[] = []
  for (let t = 0; t <= total; t += paso) ticks.push(t)

  return (
    <Card
      titulo="Meta 4 → Axton, trimestre a trimestre"
      subtitulo={legacyCount
        ? `Cuentas al cierre de cada trimestre · ${legacyCount} ya estaban en Axton + ${totalPrograma} del programa = ${total}`
        : `Cuentas al cierre de cada trimestre · total ${total}`}
      accion={<BotonTabla activo={tabla} onClick={() => setTabla(v => !v)} />}
    >
      <LeyendaTrimestres />

      {tabla ? (
        <TablaTrimestres trimestres={trimestres} legacyCount={legacyCount} />
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Eje Y */}
          <div style={{ position: 'relative', width: 18, height: PLOT_H, flexShrink: 0 }}>
            {ticks.map(t => (
              <span key={t} className="num" style={{
                position: 'absolute', bottom: escala(t) - 6, right: 0,
                fontSize: 10, color: 'var(--t3)', lineHeight: '12px',
              }}>{t}</span>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', height: PLOT_H }}>
              {/* Grid hairline, sólido y recesivo */}
              {ticks.map(t => (
                <div key={t} style={{
                  position: 'absolute', left: 0, right: 0, bottom: escala(t),
                  borderTop: '1px solid var(--viz-grid)', pointerEvents: 'none',
                }} />
              ))}

              <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                {trimestres.map(t => (
                  <Columna key={t.key} t={t} escala={escala} colW={COL_W} legacyCount={legacyCount} />
                ))}
              </div>
            </div>

            {/* Eje X */}
            <div style={{ display: 'flex', marginTop: 6 }}>
              {trimestres.map(t => (
                <div key={t.key} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <span className="num" style={{ fontSize: 10.5, color: 'var(--t2)', fontWeight: 600 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Leyenda de los dos lados + qué significa el corchete. */
function LeyendaTrimestres() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--viz-axton)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--t2)' }}>En Axton</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--viz-meta4)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--t2)' }}>En Meta 4</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {/* Mismo glifo que el del gráfico, para que la asociación sea inmediata. */}
        <span style={{
          width: 5, height: 11, flexShrink: 0,
          borderLeft: '1.5px solid var(--t2)', borderTop: '1.5px solid var(--t2)',
          borderBottom: '1.5px solid var(--t2)',
        }} />
        <span style={{ fontSize: 11, color: 'var(--t2)' }}>Migraron en ese trimestre</span>
      </div>
    </div>
  )
}

function Columna({ t, escala, colW, legacyCount }: {
  t: ReturnType<typeof migracionPorTrimestre>[number]
  escala: (n: number) => number
  colW: number
  legacyCount: number
}) {
  const enAxton = legacyCount + t.enVivo
  const enMeta4 = t.enMigracion + t.sinEmpezar
  const nuevas = t.salidas.length

  const hAxton = escala(enAxton)
  const hMeta4 = escala(enMeta4)
  // El corchete abarca justo el pedazo de verde que llegó en este trimestre.
  const baseNuevas = escala(enAxton - nuevas)
  const hNuevas = hAxton - baseNuevas

  const titulo = [
    t.label,
    `En Axton: ${enAxton}` + (legacyCount ? ` (${legacyCount} previas + ${t.enVivo} migradas)` : ''),
    `En Meta 4: ${enMeta4} (${t.enMigracion} en migración · ${t.sinEmpezar} sin empezar)`,
    nuevas ? `Migraron en el trimestre: ${t.salidas.join(', ')}` : 'No migró ninguna en el trimestre',
  ].join('\n')

  return (
    <div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }} title={titulo}>
      {/* Columna centrada; el corchete vive afuera, en el aire de la banda. */}
      <div style={{
        position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: colW, height: '100%',
      }}>
        {/* Lado Axton (acento), desde la base */}
        {enAxton > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            height: Math.max(2, enMeta4 > 0 ? hAxton - 2 : hAxton),   // 2px de aire si hay bloque arriba
            background: 'var(--viz-axton)',
            borderRadius: enMeta4 > 0 ? 0 : '4px 4px 0 0',
          }} />
        )}
        {/* Lado Meta 4 (de-énfasis), arriba */}
        {enMeta4 > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: hAxton,
            height: Math.max(2, hMeta4), background: 'var(--viz-meta4)',
            borderRadius: '4px 4px 0 0',
          }} />
        )}

        {/* Totales, cada uno dentro de su bloque */}
        {enAxton > 0 && hAxton >= 18 && (
          <span className="num" style={{
            position: 'absolute', left: 0, right: 0, bottom: hAxton / 2 - 8, textAlign: 'center',
            fontSize: 12, fontWeight: 800, color: '#fff', lineHeight: '16px',
          }}>{enAxton}</span>
        )}
        {enMeta4 > 0 && hMeta4 >= 18 && (
          <span className="num" style={{
            position: 'absolute', left: 0, right: 0, bottom: hAxton + hMeta4 / 2 - 8, textAlign: 'center',
            fontSize: 12, fontWeight: 800, color: 'var(--t1)', lineHeight: '16px',
          }}>{enMeta4}</span>
        )}
      </div>

      {/* Corchete: marca exactamente las que migraron en este trimestre. */}
      {nuevas > 0 && (
        <div style={{
          position: 'absolute', bottom: baseNuevas, height: Math.max(7, hNuevas),
          left: `calc(50% + ${colW / 2}px + 4px)`,
          display: 'flex', alignItems: 'center', gap: 3, pointerEvents: 'none',
        }}>
          <span style={{
            width: 4, height: '100%', flexShrink: 0,
            borderLeft: '1.5px solid var(--t3)', borderTop: '1.5px solid var(--t3)',
            borderBottom: '1.5px solid var(--t3)',
          }} />
          {/* El número va en tinta, no en el color del dato: la asociación la hace el
              corchete que lo toca, no el color de la letra. */}
          <span className="num" style={{
            fontSize: 11, fontWeight: 800, color: 'var(--t1)', whiteSpace: 'nowrap', lineHeight: 1,
          }}>+{nuevas}</span>
        </div>
      )}
    </div>
  )
}

function TablaTrimestres({ trimestres, legacyCount }: {
  trimestres: ReturnType<typeof migracionPorTrimestre>; legacyCount: number
}) {
  return (
    <div style={{ maxHeight: 218, overflowY: 'auto', marginTop: 4 }}>
      <table className="num" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr>
            <Th align="left">Trim.</Th>
            {legacyCount > 0 && <Th>Legacy</Th>}
            <Th>En Meta 4</Th><Th>En migración</Th><Th>Migrada</Th>
            {legacyCount > 0 && <Th>Total Axton</Th>}
            <Th>Salidas</Th>
          </tr>
        </thead>
        <tbody>
          {trimestres.map(t => (
            <tr key={t.key} style={{ borderTop: '1px solid var(--line-soft)' }}>
              <Td align="left">{t.label}</Td>
              {legacyCount > 0 && <Td>{legacyCount}</Td>}
              <Td>{t.sinEmpezar}</Td>
              <Td>{t.enMigracion}</Td>
              <Td><strong>{t.enVivo}</strong></Td>
              {legacyCount > 0 && <Td><strong>{legacyCount + t.enVivo}</strong></Td>}
              <Td>{t.salidas.length || '—'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ══ Equipo ════════════════════════════════════════════════════════════════════

/**
 * Cuántas cuentas toma cada persona (el número, que es la pregunta) y en qué papel
 * (la barra, desglosada por fase). Dos unidades distintas, cada una rotulada.
 */
function EquipoCard({ carga }: { carga: ReturnType<typeof cargaPorPersona> }) {
  const conCarga = carga.filter(c => c.fases > 0)
  const sinCarga = carga.filter(c => c.fases === 0)
  const maxFases = Math.max(1, ...conCarga.map(c => c.fases))

  const seriesFase = ORDEN_FASES.map(t => ({ key: t, label: TIPO_LABEL[t], color: VIZ_FASE[t] }))

  return (
    <Card titulo="Quién hace cada cuenta" subtitulo="El número son cuentas distintas · la barra, sus fases">
      <Leyenda series={seriesFase} />
      {conCarga.length === 0 ? (
        <Vacio>Nadie tiene fases asignadas todavía.</Vacio>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 4 }}>
          {conCarga.map(c => (
            <div key={c.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{c.alias}</span>
                <span className="num" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--celeste-dark)' }}>
                  {c.cuentas}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t2)' }}>cuenta{c.cuentas !== 1 ? 's' : ''}</span>
                <span className="num" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--t3)' }}>
                  {c.fases} fase{c.fases !== 1 ? 's' : ''}
                </span>
              </div>
              {/* Barra apilada por fase: 2px de gap en superficie, punta redondeada. */}
              <div style={{ display: 'flex', gap: 2, height: 10, alignItems: 'stretch' }}
                title={ORDEN_FASES.map(t => `${TIPO_LABEL[t]}: ${c.porTipo[t]}`).join(' · ')}>
                {ORDEN_FASES.map((t, i) => {
                  const n = c.porTipo[t]
                  if (!n) return null
                  const esUltimo = ORDEN_FASES.slice(i + 1).every(x => !c.porTipo[x])
                  return (
                    <div key={t} style={{
                      width: `${(n / maxFases) * 100}%`,
                      background: VIZ_FASE[t],
                      borderRadius: esUltimo ? '2px 4px 4px 2px' : 2,
                    }} />
                  )
                })}
              </div>
            </div>
          ))}
          {sinCarga.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              Sin fases asignadas: {sinCarga.map(c => c.alias).join(', ')}.
            </span>
          )}
        </div>
      )}
    </Card>
  )
}

// ══ Ola de migración ══════════════════════════════════════════════════════════

/**
 * Una fila por cuenta, ordenadas por fecha de salida a Axton: la migración se lee
 * como una escalera. Cada fase va en su propio carril, así se ve el solapamiento
 * entre relevamiento y configuración en vez de taparse. El rombo es el go-live.
 */
function OlaCard({ cuentas, hoyISO, onCuenta }: {
  cuentas: CuentaMigracion[]; hoyISO: string; onCuenta: (id: string) => void
}) {
  const conPlan = cuentas.filter(c => c.inicio && c.enVivo)
    .sort((a, b) => (a.enVivo! < b.enVivo! ? -1 : a.enVivo! > b.enVivo! ? 1 : 0))
  const sinPlan = cuentas.filter(c => !c.inicio || !c.enVivo)

  if (conPlan.length === 0) {
    return (
      <Card titulo="Ola de migración">
        <Vacio>Sin cuentas planificadas: acá se ve el orden en que van saliendo a Axton.</Vacio>
      </Card>
    )
  }

  const desde = conPlan.reduce((m, c) => (c.inicio! < m ? c.inicio! : m), conPlan[0].inicio!)
  const hasta = conPlan.reduce((m, c) => (c.enVivo! > m ? c.enVivo! : m), conPlan[0].enVivo!)
  const t0 = parseISO(desde).getTime()
  const span = Math.max(1, parseISO(hasta).getTime() - t0)
  const pct = (iso: string) => ((parseISO(iso).getTime() - t0) / span) * 100

  // Límites de trimestre dentro del rango, para el grid y las etiquetas del eje.
  const limites: Array<{ iso: string; label: string }> = []
  const dDesde = parseISO(desde)
  let anio = dDesde.getFullYear()
  let trim = Math.floor(dDesde.getMonth() / 3) + 1
  for (let i = 0; i < 40; i++) {
    const iso = `${anio}-${String(trim * 3 - 2).padStart(2, '0')}-01`
    if (iso > hasta) break
    if (iso >= desde) limites.push({ iso, label: `T${trim} ${String(anio).slice(2)}` })
    trim++
    if (trim > 4) { trim = 1; anio++ }
  }

  const ROW_H = 20
  const LANE_H = 5
  const hoyPct = hoyISO >= desde && hoyISO <= hasta ? pct(hoyISO) : null
  const NAME_W = 104

  const seriesFase = ORDEN_FASES.map(t => ({ key: t, label: TIPO_LABEL[t], color: VIZ_FASE[t] }))

  return (
    <Card
      titulo="Ola de migración"
      subtitulo={`${conPlan.length} cuentas ordenadas por fecha de salida · ${formatFecha(desde)} → ${formatFecha(hasta)}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Leyenda series={seriesFase} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Rombo />
          <span style={{ fontSize: 11, color: 'var(--t2)' }}>Sale en vivo</span>
        </div>
      </div>

      <div style={{ display: 'flex', marginTop: 6 }}>
        <div style={{ width: NAME_W, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 14 }}>
          {limites.map(l => (
            <span key={l.iso} className="num" style={{
              position: 'absolute', left: `${pct(l.iso)}%`, fontSize: 10, color: 'var(--t3)',
              fontWeight: 600, transform: 'translateX(2px)', whiteSpace: 'nowrap',
            }}>{l.label}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        {/* Nombres */}
        <div style={{ width: NAME_W, flexShrink: 0 }}>
          {conPlan.map(c => (
            <button key={c.id} onClick={() => onCuenta(c.id)}
              title={`Ver ${c.nombre} en el timeline`}
              style={{
                height: ROW_H, width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 8px 0 0',
                fontSize: 11.5, fontWeight: 600, color: 'var(--t1)', textAlign: 'left',
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</span>
              {c.especial && <span style={{ fontSize: 8.5, fontWeight: 800, color: 'var(--tasa)', flexShrink: 0 }}>TASA</span>}
            </button>
          ))}
        </div>

        {/* Carriles */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {limites.map(l => (
            <div key={l.iso} style={{
              position: 'absolute', top: 0, bottom: 0, left: `${pct(l.iso)}%`,
              borderLeft: '1px solid var(--viz-grid)', pointerEvents: 'none',
            }} />
          ))}
          {hoyPct != null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: `${hoyPct}%`,
              borderLeft: '2px solid var(--celeste)', pointerEvents: 'none', zIndex: 2,
            }} />
          )}

          {conPlan.map(c => (
            <div key={c.id} style={{ height: ROW_H, position: 'relative' }}>
              {c.fases.map(f => {
                const lane = ORDEN_FASES.indexOf(f.tipo)
                const top = lane < 0 ? ROW_H / 2 - LANE_H / 2 : 2 + lane * (LANE_H + 1)
                const left = pct(f.inicio)
                const width = Math.max(0.35, pct(f.fin) - left)
                return (
                  <div key={f.id}
                    title={`${c.nombre} · ${TIPO_LABEL[f.tipo]}\n${formatFechaCorta(f.inicio)} → ${formatFechaCorta(f.fin)}`}
                    style={{
                      position: 'absolute', top, left: `${left}%`, width: `${width}%`, height: LANE_H,
                      background: VIZ_FASE[f.tipo], borderRadius: 3,
                    }} />
                )
              })}
              {/* Rombo de go-live, con anillo de superficie para que se lea sobre el grid. */}
              <div title={`${c.nombre} sale en vivo el ${formatFecha(c.enVivo!)}`}
                style={{
                  position: 'absolute', left: `${pct(c.enVivo!)}%`, top: ROW_H / 2 - 5,
                  width: 10, height: 10, marginLeft: -5, transform: 'rotate(45deg)',
                  background: 'var(--viz-vivo)', border: '2px solid var(--white)', borderRadius: 2, zIndex: 3,
                }} />
            </div>
          ))}
        </div>
      </div>

      {sinPlan.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--warn-tx)', marginTop: 8, display: 'block' }}>
          ⚠ Sin planificar, fuera de la ola: {sinPlan.map(c => c.nombre).join(', ')}.
        </span>
      )}
    </Card>
  )
}

// ══ Piezas ════════════════════════════════════════════════════════════════════

function Hero({ label, valor, nota, alerta }: { label: string; valor: string; nota: string; alerta: string | null }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14,
      padding: '16px 20px', boxShadow: 'var(--sh-sm)', minWidth: 268, display: 'flex',
      flexDirection: 'column', justifyContent: 'center', gap: 2,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {/* Cifra guía: una sola por vista, en la misma sans y con figuras proporcionales. */}
      <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>{valor}</span>
      <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>{nota}</span>
      {alerta && <span style={{ fontSize: 11, color: 'var(--warn-tx)', fontWeight: 600 }}>⚠ {alerta}</span>}
    </div>
  )
}

function Kpi({ label, valor, nota }: { label: string; valor: string | number; nota?: string }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--sh-sm)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--ink)', marginTop: 3, lineHeight: 1.15 }}>{valor}</div>
      {nota && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>{nota}</div>}
    </div>
  )
}

function Card({ titulo, subtitulo, accion, children }: {
  titulo: string; subtitulo?: string; accion?: ReactNode; children: ReactNode
}) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-sm)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{titulo}</h3>
          {subtitulo && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{subtitulo}</div>}
        </div>
        {accion && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{accion}</div>}
      </div>
      {children}
    </div>
  )
}

/** Leyenda: siempre presente con 2+ series, para que la identidad no dependa del color. */
function Leyenda({ series }: { series: Array<{ key: string; label: string; color: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
      {series.map(s => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--t2)' }}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function Rombo() {
  return (
    <span style={{
      width: 9, height: 9, background: 'var(--viz-vivo)', transform: 'rotate(45deg)',
      borderRadius: 2, flexShrink: 0, display: 'inline-block',
    }} />
  )
}

function BotonTabla({ activo, onClick }: { activo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={activo ? 'Ver el gráfico' : 'Ver los números exactos'}
      style={{
        padding: '3px 10px', border: '1.5px solid var(--line)', borderRadius: 9999,
        background: activo ? 'var(--celeste)' : 'var(--white)', color: activo ? '#fff' : 'var(--t2)',
        fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {activo ? 'Gráfico' : 'Tabla'}
    </button>
  )
}

const Vacio = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' } as CSSProperties}>{children}</span>
)

function Th({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align, padding: '4px 6px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>
}

function Td({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align, padding: '4px 6px', color: 'var(--t1)' }}>{children}</td>
}
