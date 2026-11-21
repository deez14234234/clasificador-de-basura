import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, esquina, radio } from './tokens';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Si se pasa, la tarjeta entera es pulsable. */
  onPress?: () => void;
  etiqueta?: string;
  deshabilitada?: boolean;
};

/** Superficie de vidrio: translúcida, con borde fino y esquinas amplias. */
function TarjetaBase({ children, style, onPress, etiqueta, deshabilitada }: Props) {
  if (!onPress) return <View style={[estilos.raiz, style]}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitada}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        estilos.raiz,
        style,
        pressed && estilos.pulsada,
        deshabilitada && estilos.inactiva,
      ]}
    >
      {children}
    </Pressable>
  );
}

export const Tarjeta = memo(TarjetaBase);

const estilos = StyleSheet.create({
  raiz: {
    backgroundColor: color.vidrio,
    borderWidth: 1,
    borderColor: color.borde,
    borderRadius: radio.l,
    borderCurve: esquina,
    padding: 18,
  },
  pulsada: { transform: [{ scale: 0.985 }], backgroundColor: color.vidrioAlto },
  inactiva: { opacity: 0.45 },
});
