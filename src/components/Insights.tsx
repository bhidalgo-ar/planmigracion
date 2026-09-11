import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useSimuladorStore } from '../store'
import { formatFecha, formatFechaCorta, toISO } from '../utils/dates'
import {
  cuentasFueraDelPlan, cuentasMigracion, migracionPorTrimestre, resumenMigracion,
} from '../insightsMigracion'


/**
 * Vista Insights: cómo avanza la migración de Meta 4 a Axton.
 *
 * Responde tres preguntas y nada más: cuándo sale cada cuenta a producción, cuántas
 * cuentas quedan en Meta 4 en cada trimestre, y quién hace qué. Los conflictos de
 * capacidad NO viven acá: para eso está el resaltado del timeline y el chip de la
 * barra superior, que están siempre a la vista.
 */
export function Insights() {
  const { proyectos, asignaciones, config } = useSimuladorStore()

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
      r: resumenMigracion(todas, hoyISO, new Set(overrideIds)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectos, asignaciones, config, hoyISO, overrideKey])

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

      {/* ── Fila media: avance por trimestre (el reparto del equipo vive en la pestaña Equipo) ── */}
      <div style={{ marginBottom: 18 }}>
        <TrimestresCard trimestres={d.trimestres} totalPrograma={d.r.totalCuentas} legacyCount={legacyCount} />
      </div>

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

export function Kpi({ label, valor, nota }: { label: string; valor: string | number; nota?: string }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--sh-sm)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--ink)', marginTop: 3, lineHeight: 1.15 }}>{valor}</div>
      {nota && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>{nota}</div>}
    </div>
  )
}

export function Card({ titulo, subtitulo, accion, children }: {
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
export function Leyenda({ series }: { series: Array<{ key: string; label: string; color: string }> }) {
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

export const Vacio = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' } as CSSProperties}>{children}</span>
)

export function Th({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ textAlign: align, padding: '4px 6px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>
}

export function Td({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <td style={{ textAlign: align, padding: '4px 6px', color: 'var(--t1)' }}>{children}</td>
}
