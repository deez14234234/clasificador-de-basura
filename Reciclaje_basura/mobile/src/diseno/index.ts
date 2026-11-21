/**
 * Sistema de diseño "Neón Nocturno".
 *
 * Las pantallas importan de aquí, nunca de los paquetes de iconos, SVG o
 * animación directamente. Eso permite cambiar una decisión visual --o la
 * librería que la implementa-- en un solo sitio.
 */

export { Anillo } from './Anillo';
export { Aparecer } from './Aparecer';
export { Boton, BotonIcono, BotonTexto, type VarianteBoton } from './Boton';
export { Chip } from './Chip';
export { Fondo, Pantalla } from './Fondo';
export { Hoja } from './Hoja';
export { Icono, type NombreIcono } from './Icono';
export { Pulso } from './Pulso';
export { Tacho } from './Tacho';
export { Tarjeta } from './Tarjeta';
export { Texto } from './Texto';
export { Visor } from './Visor';
export {
  color,
  esp,
  esquina,
  fuentes,
  radio,
  sombra,
  TACTIL_MINIMO,
  tipo,
  tonoVisible,
  type NivelTipo,
} from './tokens';

/** Alto que ocupa la barra de pestañas flotante, sin contar el área segura. */
export const ALTO_BARRA = 112;
