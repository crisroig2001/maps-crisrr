// El corro: un grupo de gente hablando, aquí y ahora.
//
// Hasta ahora lo que decías lo oía TODO el que anduviera cerca, y no había
// forma de decirle algo a una persona en concreto ni de saber, mirando el
// mundo, si dos que están juntos están hablando o solo se han cruzado. Un
// corro es las dos cosas a la vez:
//
//   - Lo que se dice dentro solo lo leen sus miembros. Los de fuera VEN que
//     hablan (una burbuja con «…» sobre la cabeza), pero no lo que dicen:
//     es lo mismo que pasa en la calle cuando pasas al lado de dos que
//     charlan.
//   - En el mundo 3D se dibuja un CÍRCULO en el suelo alrededor del grupo,
//     con un aro a los pies de cada uno. Así se ve desde lejos quién está
//     hablando con quién, y quien llega sabe que hay una conversación
//     antes de meterse en ella.
//
// Entrar tiene puerta: quien lo empezó (el anfitrión) invita a alguien, o
// alguien de fuera LLAMA y el anfitrión le deja entrar. Un corro abierto no
// tiene puerta: cualquiera que pase se une, que es lo que hace falta en una
// fiesta en la plaza.
//
// Vive en la MEMORIA del servidor, como la presencia y como lo que se dice:
// no se guarda en disco ni deja registro. Un corro que se deshace no ha
// existido nunca para nadie más.
//
// Estas constantes las comparten cliente y servidor, así que aquí no hay
// dependencias: el cliente avisa antes de que te salgas y el servidor es
// quien te saca.

// Cuánta gente cabe. Ocho es una conversación; más es un público.
export const CORRO_MAX = 8;

// A qué distancia se puede invitar a alguien o llamar a su puerta: hay que
// estar al lado, como para hablarle.
export const CORRO_CERCA_M = 12;

// Un corro está en un SITIO: si te alejas más de esto del resto, sales solo.
// No hace falta un botón para irse (aunque lo hay): irse es irse.
export const CORRO_RADIO_M = 20;

// El cliente avisa antes de que pase, para que nadie se caiga sin enterarse.
export const CORRO_AVISO_M = 15;

// Lo que dura una invitación o una llamada a la puerta sin contestar. Se
// caen solas: si no, al volver al mundo te esperaría una lista de gente que
// hace media hora que no está.
export const INVITACION_MS = 45_000;

// Id de corro: lo genera el servidor y viaja con la presencia.
export const RE_CORRO = /^[a-z0-9]{6,16}$/;

// Lo que el cliente puede pedir, montado en el sondeo de presencia:
//   invita  q=jugador   le pides que hable contigo (o que entre en tu corro)
//   acepta  q=jugador   aceptas su invitación
//   no      q=jugador   la rechazas
//   llama   q=corro     llamas a la puerta de un corro que ves en el mundo
//   admite  q=jugador   (anfitrión) le dejas entrar
//   echa    q=jugador   (anfitrión) le sacas del corro
//   sale                te vas
//   abre    v=booleano  (anfitrión) quitas o pones la puerta
export const ACCIONES_CORRO = new Set(['invita', 'acepta', 'no', 'llama', 'admite', 'echa', 'sale', 'abre']);
