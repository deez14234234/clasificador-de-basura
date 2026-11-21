import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  children: ReactNode;
  /** Milisegundos antes de entrar: sirve para las entradas en cascada. */
  retraso?: number;
  /** Distancia vertical desde la que sube. */
  desde?: number;
  style?: StyleProp<ViewStyle>;
};

/** Entrada con resorte: sube unos píxeles mientras aparece. */
export function Aparecer({ children, retraso = 0, desde = 24, style }: Props) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.spring(v, {
      toValue: 1,
      delay: retraso,
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, retraso]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [desde, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
