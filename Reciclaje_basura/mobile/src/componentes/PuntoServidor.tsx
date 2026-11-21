import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { color, esquina, Pulso, radio, Texto } from '../diseno';
import type { EstadoServidor } from '../ServidorContext';

const TEXTOS: Record<EstadoServidor, string> = {
  comprobando: 'Buscando',
  listo: 'En línea',
  sin_modelo: 'Sin modelo',
  caido: 'Sin conexión',
};

const TONOS: Record<EstadoServidor, string> = {
  comprobando: color.textoSuave,
  listo: color.neon,
  sin_modelo: color.aviso,
  caido: color.error,
};

type Props = { estado: EstadoServidor; onPress: () => void };

/** Estado del backend en una píldora pequeña. Tocarla vuelve a comprobar. */
function PuntoServidorBase({ estado, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Servidor: ${TEXTOS[estado]}. Toca para volver a comprobar.`}
      style={({ pressed }) => [estilos.raiz, pressed && estilos.pulsado]}
    >
      {estado === 'comprobando' ? (
        <ActivityIndicator size="small" color={color.textoSuave} style={estilos.indicador} />
      ) : (
        <Pulso tono={TONOS[estado]} tamano={7} activo={estado === 'listo'} />
      )}
      <Texto nivel="pequeno" tono={TONOS[estado]} style={estilos.texto}>
        {TEXTOS[estado]}
      </Texto>
    </Pressable>
  );
}

export const PuntoServidor = memo(PuntoServidorBase);

const estilos = StyleSheet.create({
  raiz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 2,
    paddingRight: 12,
    height: 34,
    borderRadius: radio.pildora,
    borderCurve: esquina,
    backgroundColor: color.vidrio,
    borderWidth: 1,
    borderColor: color.borde,
  },
  indicador: { width: 21, transform: [{ scale: 0.7 }] },
  texto: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 12 },
  pulsado: { opacity: 0.7 },
});
