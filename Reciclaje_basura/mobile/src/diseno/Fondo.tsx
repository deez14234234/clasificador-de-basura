import { memo, useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { color } from './tokens';

type PropsFondo = {
  /** Halo superior izquierdo. */
  acento?: string;
  /** Halo inferior derecho. */
  secundario?: string;
  intensidad?: number;
};

/** Fondo negro con dos halos de color difuminados. Es decorativo. */
function FondoBase({ acento = color.neon, secundario = color.violeta, intensidad = 1 }: PropsFondo) {
  // Los id de los degradados deben ser únicos: el stack mantiene montadas
  // varias pantallas a la vez, cada una con su propio fondo.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`a${id}`} cx="0%" cy="0%" r="75%">
            <Stop offset="0" stopColor={acento} stopOpacity={0.2 * intensidad} />
            <Stop offset="1" stopColor={acento} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`b${id}`} cx="100%" cy="90%" r="70%">
            <Stop offset="0" stopColor={secundario} stopOpacity={0.18 * intensidad} />
            <Stop offset="1" stopColor={secundario} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={color.fondo} />
        <Rect width="100%" height="100%" fill={`url(#a${id})`} />
        <Rect width="100%" height="100%" fill={`url(#b${id})`} />
      </Svg>
    </View>
  );
}

export const Fondo = memo(FondoBase);

type PropsPantalla = PropsFondo & { children: ReactNode; style?: StyleProp<ViewStyle> };

/** Contenedor de pantalla con el fondo de halos detrás. */
export function Pantalla({ children, style, ...fondo }: PropsPantalla) {
  return (
    <View style={[estilos.pantalla, style]}>
      <Fondo {...fondo} />
      {children}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: color.fondo },
});
