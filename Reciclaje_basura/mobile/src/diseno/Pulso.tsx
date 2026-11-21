import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

type Props = { tono: string; tamano?: number; activo?: boolean };

/** Punto de estado con una onda que se expande, como un indicador "en vivo". */
function PulsoBase({ tono, tamano = 9, activo = true }: Props) {
  const onda = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!activo) {
      onda.setValue(0);
      return;
    }
    const bucle = Animated.loop(
      Animated.timing(onda, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    bucle.start();
    return () => bucle.stop();
  }, [activo, onda]);

  const lado = tamano * 3;

  return (
    <View style={{ width: lado, height: lado, alignItems: 'center', justifyContent: 'center' }}>
      {activo ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: lado / 2,
              backgroundColor: tono,
              opacity: onda.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
              transform: [{ scale: onda.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
            },
          ]}
        />
      ) : null}
      <View
        style={{
          width: tamano,
          height: tamano,
          borderRadius: tamano / 2,
          backgroundColor: tono,
          boxShadow: `0 0 8px ${tono}`,
        }}
      />
    </View>
  );
}

export const Pulso = memo(PulsoBase);
