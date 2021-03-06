import * as chalk from 'chalk'

import { ServerMsgType, WS, Row, ClientMessage } from '../../lib/structs'
import { createWS } from './'
import { updateAlphabet } from '../../'
import { display, MsgColors } from '../../cli/printer'
import { resetRl, rl, question, repl } from '../../cli/repl'
import { msg } from './msg'

// let input_data = ''
// process.stdin.on('data', function (input) {
//   input_data += input // Reading input from STDIN
// })

export async function requestSession(
  address: string,
  session_id: string | undefined,
) {
  // create connection
  const ws = await createWS(address)
  // server eventually responds with user_id

  // request session id
  if (!session_id) {
    msg(ws, { type: ServerMsgType.create, user_id: ws.user_id })
  } else {
    msg(ws, { type: ServerMsgType.join, user_id: ws.user_id, session_id })
  }

  return ws
}

let deciding = false

export function guess(cnx: WS, message: ClientMessage) {
  if (deciding || !message.content || typeof message.content === 'string') {
    return
  }

  updateAlphabet(message.content.guess as Row)

  display.addToGuesses(message.content.guess as Row)
  display.alterMessage(
    chalk.hex('#ffaf5f')(
      `${message.content.rem} guess${
        message.content.rem > 1 ? 'es' : ''
      } remaining`,
    ),
  )

  // replace cursor text
  let replace = false
  if (rl.getCursorPos().cols) replace = true
  if (replace) rl.write(null, { ctrl: true, name: 'u' })

  display.print()

  if (replace) rl.write(null, { ctrl: true, name: 'y' })
}

export async function again(cnx: WS, message: ClientMessage) {
  if (message.user_id) {
    display.alterMessage(`WINNER: ${message['user_id']}!`, MsgColors['green'])
  } else {
    display.alterMessage(
      `GAME OVER: ${message['content']}!`,
      MsgColors.redBright,
    )
  }

  display.print()

  // close readline
  rl.close()

  deciding = true

  // open new realine
  const again_rl = resetRl(cnx)
  const again_yn = await question('play again?  y/n ', again_rl)

  again_rl.close()

  // send response
  msg(cnx, { type: ServerMsgType.again, content: again_yn })

  if (!/^y/i.test(again_yn)) {
    return
  }

  // reset screen
  display.clear(cnx.user_id, cnx.session_id)
  deciding = false

  // start a new repl
  await repl(cnx)
}
