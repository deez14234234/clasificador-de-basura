/**
 * Dirección del backend y su estado, disponibles en todas las pantallas.
 *
 * El estado se comprueba desde la pantalla de inicio, antes de abrir la
 * cámara: así el usuario se entera de que el servidor está caído mientras aún
 * puede hacer algo al respecto, y no después de apuntar a un residuo.
 *
 * Cuando la dirección es automática, la comprobación hace de descubrimiento:
 * prueba los puertos candidatos y se queda con el primero que responde.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { obtenerSalud, type Salud } from './api';
import { useServidor } from './useServidor';

export type EstadoServidor = 'comprobando' | 'listo' | 'sin_modelo' | 'caido';

type Valor = {
  servidor: string;
  esAutomatico: boolean;
  cargado: boolean;
  estado: EstadoServidor;
  salud: Salud | null;
  comprobar: () => void;
  guardar: (valor: string) => void;
  restaurarAutomatico: () => void;
};

const Ctx = createContext<Valor | null>(null);

export function ProveedorServidor({ children }: { children: ReactNode }) {
  const { candidatos, fijado, esAutomatico, guardar, restaurarAutomatico, cargado } =
    useServidor();

  const [resuelto, setResuelto] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoServidor>('comprobando');
  const [salud, setSalud] = useState<Salud | null>(null);
  // Identifica la comprobación en curso: si la dirección cambia a mitad, la
  // respuesta vieja no debe pisar el estado de la nueva.
  const turno = useRef(0);

  const servidor = fijado ?? resuelto ?? candidatos[0];

  const comprobar = useCallback(() => {
    if (!cargado) return;
    const mio = ++turno.current;
    setEstado('comprobando');

    // Con dirección fija sólo se comprueba esa; en automático se recorren los
    // puertos candidatos hasta dar con uno vivo.
    const aProbar = fijado ? [fijado] : candidatos;

    (async () => {
      for (const direccion of aProbar) {
        try {
          const s = await obtenerSalud(direccion);
          if (mio !== turno.current) return;
          setResuelto(direccion);
          setSalud(s);
          setEstado(s.estado === 'ok' && s.modelo ? 'listo' : 'sin_modelo');
          return;
        } catch {
          if (mio !== turno.current) return;
          // Ese puerto no contesta: se prueba el siguiente.
        }
      }
      if (mio !== turno.current) return;
      setSalud(null);
      setEstado('caido');
    })();
  }, [cargado, fijado, candidatos]);

  useEffect(comprobar, [comprobar]);

  return (
    <Ctx.Provider
      value={{
        servidor,
        esAutomatico,
        cargado,
        estado,
        salud,
        comprobar,
        guardar,
        restaurarAutomatico,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useServidorCtx(): Valor {
  const v = useContext(Ctx);
  if (!v) throw new Error('useServidorCtx fuera de ProveedorServidor');
  return v;
}
