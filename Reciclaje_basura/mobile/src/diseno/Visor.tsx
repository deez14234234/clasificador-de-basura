import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  tono: string;
  opacidad?: number;
  /** Muestra la línea de barrido mientras no hay lectura. */
  barriendo?: boolean;
  style?: StyleProp<ViewStyle>;
};

const BRAZO = 46;
const GROSOR = 4;
const CURVA = 26;

/** Marco de escáner: cuatro esquinas que brillan con el color detectado. */
function VisorBase({ tono, opacidad = 1, barriendo = false, style }: Props) {
  const [alto, setAlto] = useState(0);
  const barrido = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!barriendo || alto === 0) return;
    const bucle = Animated.loop(
      Animated.sequence([
        Animated.timing(barrido, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(barrido, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    bucle.start();
    return () => bucle.stop();
  }, [barriendo, alto, barrido]);

  const brillo = { borderColor: tono, boxShadow: `0 0 14px ${tono}` };

  return (
    <View
      style={[estilos.raiz, { opacity: opacidad }, style]}
      onLayout={(e) => setAlto(e.nativeEvent.layout.height)}
    >
      <View style={[estilos.esquina, estilos.si, brillo]} />
      <View style={[estilos.esquina, estilos.sd, brillo]} />
      <View style={[estilos.esquina, estilos.ii, brillo]} />
      <View style={[estilos.esquina, estilos.id, brillo]} />
      {barriendo && alto > 0 ? (
        <Animated.View
          style={[
            estilos.linea,
            {
              backgroundColor: tono,
              boxShadow: `0 0 16px ${tono}`,
              transform: [
                {
                  translateY: barrido.interpolate({
                    inputRange: [0, 1],
                    outputRange: [CURVA, alto - CURVA],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export const Visor = memo(VisorBase);

const estilos = StyleSheet.create({
  raiz: { aspectRatio: 1 },
  esquina: { position: 'absolute', width: BRAZO, height: BRAZO },
  si: { top: 0, left: 0, borderTopWidth: GROSOR, borderLeftWidth: GROSOR, borderTopLeftRadius: CURVA },
  sd: { top: 0, right: 0, borderTopWidth: GROSOR, borderRightWidth: GROSOR, borderTopRightRadius: CURVA },
  ii: { bottom: 0, left: 0, borderBottomWidth: GROSOR, borderLeftWidth: GROSOR, borderBottomLeftRadius: CURVA },
  id: { bottom: 0, right: 0, borderBottomWidth: GROSOR, borderRightWidth: GROSOR, borderBottomRightRadius: CURVA },
  linea: { position: 'absolute', left: 18, right: 18, top: 0, height: 2, borderRadius: 1, opacity: 0.8 },
});
