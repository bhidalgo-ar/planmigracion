/**
 * Los tres únicos movimientos del video del resumen ejecutivo, más el easing.
 *
 * La idea: NADA se anima con `useEffect` ni con transiciones de CSS. Todo el video es
 * una función pura del reloj `T` (segundos desde el arranque de la pieza). Si querés
 * ver el segundo 31, ponés T = 31 y el árbol se dibuja exactamente igual siempre. Eso
 * es lo que hace que se pueda ir y venir con el scrubber y exportar frame por frame.
 *
 * Tres movimientos y nada más, para que todo el video se sienta de la misma pieza:
 *   enter  aparecer subiendo un poco (títulos, leyendas)
 *   draw   dibujarse de 0 a 1 (líneas, barras, y también para fundir con `1 - draw`)
 *   pop    aparecer con un rebotecito (puntos, pills, cápsulas)
 */

/** Deja `n` adentro del rango [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/** Interpola entre `a` y `b` según `p` (0 → a, 1 → b). */
export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p
}

export const Easing = {
  /** Arranca rápido y frena. Para cosas que entran. */
  easeOutCubic: (p: number) => 1 - Math.pow(1 - p, 3),
  /** Arranca y termina suave. Para trazos que se dibujan. */
  easeInOutCubic: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  /** Se pasa un poquito y vuelve: el rebote del `pop`. */
  easeOutBack: (p: number) => {
    const c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
  },
}

/** Estilo listo para pegar en un `style={{...}}`: opacidad + desplazamiento vertical. */
export interface EstiloMovimiento {
  opacity: number
  transform: string
}

/** Aparecer subiendo 24 px. */
export function enter(T: number, inicio: number, dur = 0.7): EstiloMovimiento {
  const e = Easing.easeOutCubic(clamp((T - inicio) / dur, 0, 1))
  return { opacity: e, transform: `translateY(${(1 - e) * 24}px)` }
}

/** Progreso 0 → 1. Se usa para dibujar y, como `1 - draw(...)`, para fundir. */
export function draw(T: number, inicio: number, dur = 0.8): number {
  return Easing.easeInOutCubic(clamp((T - inicio) / dur, 0, 1))
}

/** Aparecer con rebote: la opacidad sube al toque y la escala va de 0.6 a 1. */
export function pop(T: number, inicio: number, dur = 0.6): EstiloMovimiento {
  const p = clamp((T - inicio) / dur, 0, 1)
  return { opacity: Math.min(1, p * 3), transform: `scale(${0.6 + 0.4 * Easing.easeOutBack(p)})` }
}
