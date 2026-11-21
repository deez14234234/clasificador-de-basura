/**
 * Datos de la norma y formateadores compartidos por todas las pantallas.
 *
 * `theme` se mantiene por compatibilidad; los estilos nuevos usan los tokens
 * de `diseno/tokens.ts`.
 */

export const theme = {
  fondo: '#07090D',
  superficie: 'rgba(255,255,255,0.05)',
  superficieAlta: 'rgba(255,255,255,0.09)',
  borde: 'rgba(255,255,255,0.09)',
  texto: '#F3F6F9',
  textoSuave: '#98A2B3',
  acento: '#C6F432',
  acentoSuave: 'rgba(198,244,50,0.14)',
  error: '#FF4D6D',
  aviso: '#FFB020',
  radio: 26,
  radioChico: 18,
  espacio: 20,
} as const;

export type ColorNTP = {
  key: string;
  nombre: string;
  residuos: string;
  hex: string;
  textoHex: string;
  ejemplos: string;
};

/**
 * Los 7 contenedores de la NTP 900.058.
 *
 * El backend devuelve estos mismos datos en /api/classes, pero la app los trae
 * incrustados para que la guía de colores se pueda consultar sin servidor:
 * es justo la información que más falta hace cuando uno está frente al tacho
 * y no tiene la laptop encendida.
 */
export const COLORES_NTP: readonly ColorNTP[] = [
  {
    key: 'azul',
    nombre: 'Azul',
    residuos: 'Papel y cartón',
    hex: '#1565C0',
    textoHex: '#FFFFFF',
    ejemplos: 'Periódicos, cuadernos, cajas, envases de cartón.',
  },
  {
    key: 'amarillo',
    nombre: 'Amarillo',
    residuos: 'Metales',
    hex: '#F9A825',
    textoHex: '#1A1A1A',
    ejemplos: 'Latas de conserva y de bebida, tapas, chatarra pequeña.',
  },
  {
    key: 'blanco',
    nombre: 'Blanco',
    residuos: 'Plásticos',
    hex: '#F5F5F5',
    textoHex: '#1A1A1A',
    ejemplos: 'Botellas, envases, bolsas y tapas de plástico.',
  },
  {
    key: 'gris',
    nombre: 'Gris',
    residuos: 'Vidrio',
    hex: '#757575',
    textoHex: '#FFFFFF',
    ejemplos: 'Botellas y frascos de vidrio, de cualquier color.',
  },
  {
    key: 'marron',
    nombre: 'Marrón',
    residuos: 'Orgánicos',
    hex: '#6D4C41',
    textoHex: '#FFFFFF',
    ejemplos: 'Restos de comida, cáscaras, residuos de poda.',
  },
  {
    key: 'rojo',
    nombre: 'Rojo',
    residuos: 'Peligrosos',
    hex: '#C62828',
    textoHex: '#FFFFFF',
    ejemplos: 'Pilas, baterías, aerosoles, medicinas, electrónicos.',
  },
  {
    key: 'negro',
    nombre: 'Negro',
    residuos: 'Generales / no aprovechables',
    hex: '#212121',
    textoHex: '#FFFFFF',
    ejemplos: 'Papel higiénico, colillas, cerámica, envoltorios mixtos.',
  },
] as const;

export const COLOR_POR_KEY: Record<string, ColorNTP> = Object.fromEntries(
  COLORES_NTP.map((c) => [c.key, c]),
);

/** Formateadores izados: crear uno por render es caro y siempre da lo mismo. */
export const porcentaje = new Intl.NumberFormat('es-PE', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export const hora = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit',
  minute: '2-digit',
});

export const fechaCorta = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
});

/** "hoy 14:32" o "12 oct 14:32", según haga falta. */
export function cuando(ts: number): string {
  const d = new Date(ts);
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  return mismoDia ? `hoy ${hora.format(d)}` : `${fechaCorta.format(d)} ${hora.format(d)}`;
}
