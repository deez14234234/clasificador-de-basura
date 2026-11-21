import { memo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Texto } from './Texto';
import { color, esquina, radio } from './tokens';

type Props = {
  texto: string;
  /** Punto de color a la izquierda (por ejemplo, el del tacho). */
  punto?: string;
  tono?: string;
  izquierda?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

function ChipBase({ texto, punto, tono = color.texto, izquierda, style }: Props) {
  return (
    <View style={[estilos.raiz, style]}>
      {izquierda}
      {punto ? <View style={[estilos.punto, { backgroundColor: punto }]} /> : null}
      <Texto nivel="pequeno" tono={tono} style={estilos.texto} numberOfLines={1}>
        {texto}
      </Texto>
    </View>
  );
}

export const Chip = memo(ChipBase);

const estilos = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radio.pildora,
    borderCurve: esquina,
    backgroundColor: color.velo,
    borderWidth: 1,
    borderColor: color.borde,
  },
  punto: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  texto: { fontFamily: 'SpaceGrotesk_500Medium' },
});
