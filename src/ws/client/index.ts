//@ts-strict
import { WebSocket } from 'ws'
import { WS, Message } from '../../lib/structs'
import { guess } from './session'
import { display, infoIndex, MsgColors } from '../../cli'
import { validateMsg } from './msg'
export { requestSession } from './session'

const URL = 'localhost'

const msgTypeToFn = {
  user_id: setUserId,
  session_id: setSessionId,
  info: info,
  error: error,
  guess: guess,
  create: () => null,
  join: () => null,
}

function error(ws: WS, data: string | Message) {
  // TODO:
  console.error('error from server', data)
}

function info(cnx: WS, message: Message, color: MsgColors = MsgColors.green) {
  if (typeof message.content === 'string') {
    display.alterMessage(message.content, color)
    display.print()
  }
}

function setUserId(cnx: WS, message: Message) {
  if (!message || typeof message.content !== 'string') {
    return
  }

  cnx.user_id = message.content
  display.screen.splice(infoIndex(), 0, `user id: ${cnx.user_id}`)
  display.print()
}

function setSessionId(cnx: WS, message: Message) {
  if (cnx.session_id) return
  cnx.session_id = message.session_id

  display.screen.splice(infoIndex() - 1, 0, `session id: ${cnx.session_id}`)
  display.print()
}

export function createWS(url = URL): Promise<WS> {
  return new Promise(keep => {
    const ws = new WebSocket(`ws://${url}`)

    ws.on('open', function () {
      console.log('connection established with', ws.url)
      keep(ws)
    })

    ws.on('message', function (data: string) {
      let message: Message | string
      try {
        message = validateMsg(ws, data)
      } catch (e) {
        return
      }

      try {
        msgTypeToFn[message.type](ws, message)
      } catch (e) {
        console.error('action error', message, e) // TODO:
      }
    })

    ws.on('error', function (data) {
      console.error('received: %s', data) // TODO:
      return
    })

    ws.on('close', function () {
      console.log('goodbye')
      process.exit(0)
    })
  })
}
