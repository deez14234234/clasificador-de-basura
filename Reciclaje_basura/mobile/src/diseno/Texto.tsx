import { memo } from 'react';
import { Text, type TextProps } from 'react-native';

import { color, tipo, type NivelTipo } from './tokens';

type Props = TextProps & {
  nivel?: NivelTipo;
  tono?: string;
  centrado?: boolean;
};

function TextoBase({ nivel = 'cuerpo', tono = color.texto, centrado, style, ...resto }: Props) {
  return (
    <Text
      {...resto}
      style={[tipo[nivel], { color: tono }, centrado && { textAlign: 'center' }, style]}
    />
  );
}

export const Texto = memo(TextoBase);
