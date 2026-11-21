import { memo, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { StyleProp, TextStyle } from 'react-native';

import { color } from './tokens';

export type NombreIcono = ComponentProps<typeof Ionicons>['name'];

type Props = {
  nombre: NombreIcono;
  tamano?: number;
  tono?: string;
  style?: StyleProp<TextStyle>;
};

function IconoBase({ nombre, tamano = 22, tono = color.texto, style }: Props) {
  return <Ionicons name={nombre} size={tamano} color={tono} style={style} />;
}

export const Icono = memo(IconoBase);
