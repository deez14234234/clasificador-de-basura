/**
 * Tokens del tema "Neón Nocturno".
 *
 * Fondo casi negro, superficies de vidrio translúcido y un único acento lima
 * neón para todo lo accionable. Los colores de los tachos de la NTP no viven
 * aquí: son datos de la norma (ver `theme.ts`) y se pintan tal cual.
 */

import type { TextStyle, ViewStyle } from 'react-native';

export const color = {
  fondo: '#07090D',
  fondoAlto: '#0D1117',
  vidrio: 'rgba(255,255,255,0.05)',
  vidrioAlto: 'rgba(255,255,255,0.09)',
  velo: 'rgba(7,9,13,0.62)',
  borde: 'rgba(255,255,255,0.09)',
  bordeFuerte: 'rgba(255,255,255,0.18)',
  texto: '#F3F6F9',
  textoSuave: '#98A2B3',
  textoTenue: '#5B6575',
  neon: '#C6F432',
  neonTenue: 'rgba(198,244,50,0.14)',
  sobreNeon: '#0A0F02',
  cian: '#38E1FF',
  violeta: '#8B5CFF',
  error: '#FF4D6D',
  errorTenue: 'rgba(255,77,109,0.14)',
  aviso: '#FFB020',
  avisoTenue: 'rgba(255,176,32,0.14)',
} as const;

export const esp = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const radio = { s: 12, m: 18, l: 26, pildora: 999 } as const;

/** Curva de esquina continua (tipo "squircle") en iOS; Android la ignora. */
export const esquina = 'continuous' as const;

export const TACTIL_MINIMO = 48;

/** Brillos. `boxShadow` admite color en Android con la nueva arquitectura. */
export const sombra = {
  neon: { boxShadow: '0 0 22px rgba(198,244,50,0.45)' },
  suave: { boxShadow: '0 10px 30px rgba(0,0,0,0.45)' },
  de: (hex: string, alcance = 28): ViewStyle => ({
    boxShadow: `0 0 ${alcance}px ${hex}88`,
  }),
} as const;

export const fuentes = {
  regular: 'SpaceGrotesk_400Regular',
  medio: 'SpaceGrotesk_500Medium',
  semi: 'SpaceGrotesk_600SemiBold',
  negrita: 'SpaceGrotesk_700Bold',
} as const;

export const tipo = {
  display: { fontFamily: fuentes.negrita, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
  titulo: { fontFamily: fuentes.negrita, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 },
  subtitulo: { fontFamily: fuentes.semi, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  cuerpo: { fontFamily: fuentes.regular, fontSize: 15, lineHeight: 22 },
  cuerpoFuerte: { fontFamily: fuentes.medio, fontSize: 15, lineHeight: 22 },
  pequeno: { fontFamily: fuentes.regular, fontSize: 13, lineHeight: 18 },
  etiqueta: {
    fontFamily: fuentes.semi,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  boton: { fontFamily: fuentes.semi, fontSize: 16, lineHeight: 20, letterSpacing: 0.1 },
  dato: { fontFamily: fuentes.negrita, fontSize: 15, lineHeight: 18, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type NivelTipo = keyof typeof tipo;

/**
 * Versión legible de un color de tacho sobre el fondo oscuro.
 *
 * El tacho negro (#212121) desaparece sobre #07090D; para textos, anillos y
 * brillos se sustituye por un gris claro. El bloque del tacho en sí sigue
 * pintándose con su color real.
 */
export function tonoVisible(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0,2 deja fuera al negro NTP (#212121, ~0,13) y conserva el gris y el
  // marrón (~0,46 y ~0,32).
  return luminancia < 0.2 ? '#C9CED6' : hex;
}
