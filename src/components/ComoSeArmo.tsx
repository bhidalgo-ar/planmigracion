import type { CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore, type Vista } from '../uiStore'

/**
 * Copy explicativo de cada pestaña, en castellano llano, para alguien que no estuvo en el
 * armado. Hasta el 22/09/2026 vivía en una franja fija arriba del contenido (la IntroBar);
 * como nadie la leía y costaba 40 px de alto en todas las pantallas, el texto pasó a la
 * cabeza de este modal, que se abre desde "Cómo se armó →" en la barra (spec §1).
 */
const INTRO: Partial<Record<Vista, string>> = {
  timeline: 'Cada cuenta pasa por relevamiento, configuración, pruebas y cierre. Las barras que se superponen son tareas de personas distintas que sí pueden avanzar en paralelo: no es un choque. El cierre (la actualización final) queda pegado al corte de novedades del cliente, así que es lo que de verdad define si la cuenta sale ese mes. Para mover una cuenta de mes, hacé clic en ella y elegí el mes en "Sale en vivo": las fases se rearman hacia atrás desde el corte de novedades. A mano: arrastrá una barra para ajustarla · vertical reasigna persona · el borde derecho la estira. Arrastrá el fondo (o usá el botón del medio del mouse) para desplazarte.',
  insights: 'Estas tarjetas cuentan cuándo termina la migración y cómo se ve trimestre a trimestre: son fechas y conteos, no alertas de agenda. Los choques de carga, margen o dependencia se marcan en el Timeline (barra roja) y en el chip de arriba; acá no hay umbral que ponga nada en rojo.',
  equipo: 'La capacidad de cada persona sale de su jornada (horas por día) multiplicada por su dedicación a migraciones ese mes. Esa dedicación es una perilla del plan (config.disponibilidad), no algo medido: cambiarla cambia cuánto entra, no lo que hizo cada uno.',
  resumen: 'Video de 45 segundos para gerencia: cuándo termina el programa, la foto trimestre a trimestre y el mes más apretado del equipo. Todo lo que dice y dibuja sale del plan cargado ahora mismo; nada está escrito de antemano en el video.',
}

const FILA: CSSProperties = { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, lineHeight: 1.5, color: 'var(--t1)' }
const ETQ: CSSProperties = { flexShrink: 0, minWidth: 108, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--celeste-dark)' }

/**
 * Modal "Cómo se armó este plan" (Tarea 4). Todo sale del plan cargado (mismo principio que
 * el resumen animado): las horas de la tabla, los tiers, los cortes y las reglas de
 * calendario que hoy están en `config`. Si el plan no trae algo, esa fila lo dice.
 */
export function ComoSeArmoModal() {
  const { config } = useSimuladorStore()
  const cerrar = useUIStore(s => s.cerrarComoSeArmo)
  const vista = useUIStore(s => s.vista)
  const intro = INTRO[vista]

  const horas = config.horas_por_fase
  const totalEstandar = horas ? Object.values(horas.estandar).reduce((s, n) => s + n, 0) : null
  const tiers = config.tiers_v3
  const cap = config.capacidad
  const reglas = config.reglas_calendario

  return (
    <div onClick={() => cerrar?.()} style={{ position: 'fixed', inset: 0, background: 'rgba(10,19,30,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 'var(--r, 14px)', maxWidth: 620, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '26px 28px', boxShadow: 'var(--sh)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--ink)' }}>Cómo se armó este plan</h2>
          <button onClick={() => cerrar?.()} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--t3)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--t3)' }}>Sale del plan cargado ahora. Si algo no está, dice [FALTA] en vez de inventarlo.</p>

        {/* Lo que antes decía la IntroBar de esta pestaña. */}
        {intro && (
          <p style={{ margin: '0 0 18px', padding: '10px 12px', background: 'var(--paper)', borderRadius: 10, fontSize: 12.5, lineHeight: 1.55, color: 'var(--t2)' }}>{intro}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={FILA}>
            <span style={ETQ}>Horas</span>
            <span>
              {totalEstandar
                ? <>Salen de la plantilla del tablero de horas de una cuenta estándar: <b className="num">{totalEstandar.toFixed(1)} h</b> en total ({(['Relevamiento', 'Configuracion', 'Pruebas', 'Cierre'] as const).map(t => `${t === 'Configuracion' ? 'Configuración' : t} ${horas!.estandar[t]?.toFixed(1) ?? '—'} h`).join(' · ')}).</>
                : '[FALTA] el plan no trae la tabla de horas por fase.'}
            </span>
          </div>
          <div style={FILA}>
            <span style={ETQ}>Tiers</span>
            <span>
              {tiers
                ? <>Chica, estándar, grande{tiers.xl?.length ? ' y XL' : ''} escalan esas horas según el tamaño de la cuenta: {[
                    tiers.chica?.length ? `${tiers.chica.length} chica${tiers.chica.length !== 1 ? 's' : ''}` : null,
                    tiers.std?.length ? `${tiers.std.length} estándar` : null,
                    tiers.grande?.length ? `${tiers.grande.length} grande${tiers.grande.length !== 1 ? 's' : ''}` : null,
                    tiers.xl?.length ? `${tiers.xl.length} XL` : null,
                  ].filter(Boolean).join(', ')} en este plan.</>
                : '[FALTA] el plan no trae la clasificación por tier.'}
            </span>
          </div>
          <div style={FILA}>
            <span style={ETQ}>Cortes</span>
            <span>Son fechas reales de los tableros Cronograma de Liquidación de monday (ítem "Recepción de Novedades"), una por cuenta y por mes. El ancla es la primera ronda del período: la 1Q en las quincenales, la v1 o la ronda 1 en las que llevan otro nombre.</span>
          </div>
          <div style={FILA}>
            <span style={ETQ}>Reglas</span>
            <span>
              Margen mínimo <b className="num">{cap?.margen_minimo_habiles ?? '[FALTA]'}</b> días hábiles entre el cierre y el corte · tope de <b className="num">{reglas?.tope_salidas_en_vivo_por_mes ?? '[FALTA]'}</b> salidas en vivo por mes (3 si dos son tier chico)
              {tiers?.blackout_config ? <> · blackout de configuración del <b className="num">{tiers.blackout_config[0].slice(8, 10)}/{tiers.blackout_config[0].slice(5, 7)}</b> al <b className="num">{tiers.blackout_config[1].slice(8, 10)}/{tiers.blackout_config[1].slice(5, 7)}</b></> : null}
              {reglas?.desfasaje_pruebas_habiles ? <> · las pruebas de cruce arrancan <b className="num">{reglas.desfasaje_pruebas_habiles}</b> hábiles después de que arranca la ejecución</> : null}.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
