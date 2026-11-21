/**
 * Datos de la NTP 900.058 y formateadores.
 *
 * Separado del sistema de diseño a propósito: esto es el dominio del
 * problema --qué dice la norma-- y no una decisión estética.
 */

export type ColorNTP = {
  key: string;
  nombre: string;
  residuos: string;
  hex: string;
  textoHex: string;
  ejemplos: string;
  icono: string;
};

/**
 * Los 7 contenedores del código de colores ampliado.
 *
 * El backend devuelve lo mismo en /api/classes, pero la app los trae
 * incrustados para que la guía se pueda consultar sin servidor: es justo la
 * información que más falta hace cuando uno está frente al tacho y la laptop
 * está apagada.
 */
export const COLORES_NTP: readonly ColorNTP[] = [
  {
    key: 'azul',
    nombre: 'Azul',
    residuos: 'Papel y cartón',
    hex: '#1565C0',
    textoHex: '#FFFFFF',
    ejemplos: 'Periódicos, cuadernos, cajas, envases de cartón.',
    icono: 'newspaper-outline',
  },
  {
    key: 'amarillo',
    nombre: 'Amarillo',
    residuos: 'Metales',
    hex: '#F9A825',
    textoHex: '#1A1A1A',
    ejemplos: 'Latas de conserva y de bebida, tapas, chatarra pequeña.',
    icono: 'hardware-chip-outline',
  },
  {
    key: 'blanco',
    nombre: 'Blanco',
    residuos: 'Plásticos',
    hex: '#F5F5F5',
    textoHex: '#1A1A1A',
    ejemplos: 'Botellas, envases, bolsas y tapas de plástico.',
    icono: 'water-outline',
  },
  {
    key: 'gris',
    nombre: 'Gris',
    residuos: 'Vidrio',
    hex: '#757575',
    textoHex: '#FFFFFF',
    ejemplos: 'Botellas y frascos de vidrio, de cualquier color.',
    icono: 'wine-outline',
  },
  {
    key: 'marron',
    nombre: 'Marrón',
    residuos: 'Orgánicos',
    hex: '#6D4C41',
    textoHex: '#FFFFFF',
    ejemplos: 'Restos de comida, cáscaras, residuos de poda.',
    icono: 'leaf-outline',
  },
  {
    key: 'rojo',
    nombre: 'Rojo',
    residuos: 'Peligrosos',
    hex: '#C62828',
    textoHex: '#FFFFFF',
    ejemplos: 'Pilas, baterías, aerosoles, medicinas, electrónicos.',
    icono: 'warning-outline',
  },
  {
    key: 'negro',
    nombre: 'Negro',
    residuos: 'Generales / no aprovechables',
    hex: '#212121',
    textoHex: '#FFFFFF',
    ejemplos: 'Papel higiénico, colillas, cerámica, envoltorios mixtos.',
    icono: 'trash-outline',
  },
] as const;

export const COLOR_POR_KEY: Record<string, ColorNTP> = Object.fromEntries(
  COLORES_NTP.map((c) => [c.key, c]),
);

/** Formateadores izados: crear uno por render es caro y siempre da lo mismo. */
export const porcentaje = new Intl.NumberFormat('es-PE', {
  style: 'percent',
  maximumFractionDigits: 0,
});

const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });
const fechaCorta = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' });

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
