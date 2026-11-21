import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { Prediccion } from './api';

/** Pestañas de la barra flotante. */
export type Pestanas = {
  Inicio: undefined;
  Historial: undefined;
};

/** Stack raíz: las pestañas, y encima la cámara y el resultado a pantalla completa. */
export type Rutas = {
  Principal: NavigatorScreenParams<Pestanas> | undefined;
  Camara: undefined;
  Resultado: { prediccion: Prediccion; fotoUri: string };
};

export type Props<R extends keyof Rutas> = NativeStackScreenProps<Rutas, R>;

export type PropsPestana<R extends keyof Pestanas> = CompositeScreenProps<
  BottomTabScreenProps<Pestanas, R>,
  NativeStackScreenProps<Rutas>
>;
