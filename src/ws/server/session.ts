import * as chalk from 'chalk'

import {
  WS,
  Message,
  ClientMessage,
  ServerMessage,
  MsgType,
  ClientMsgType,
  User,
  Row,
} from '../../lib/structs'
import { wordToRow, validateResponse, evaluateGuess, isCorrect } from '../../'
import { wss } from '../../cli/args'
import { msg, err } from './msg'
import { getRand, names, words, Log } from '../../util'

export class Session {
  session_id: string
  guests: User[]
  answer: string
  guesses: Row[]
  constructor(session_id: string) {
    this.session_id = session_id
    this.guests = []
    this.answer = 'ibudi'
    this.guesses = []
  }
}

export function remove(ws: WS, log?: Log) {
  if (!ws.session_id) return
  const userSession = sessions[ws.session_id]

  if (userSession && userSession.guests) {
    userSession.guests.splice(
      userSession.guests.findIndex(guest => guest.id === ws.user_id),
      1,
    )
    log &&
      log.log({
        removing: ws.user_id,
        from: ws.session_id,
        clients: wss.clients.size,
      })
  }

  // delete session if empty
  if (userSession && userSession.guests.length === 0) {
    delete sessions[ws.session_id]
  }

  // free user name
  if (ws.user_id && names[ws.user_id]) {
    names[ws.user_id] = false
  }

  // only close open(ing) connections
  if (ws.readyState < 2) {
    ws.close()
  }
}

export function createSession(
  ws: WS,
  message?: ServerMessage,
  log?: Log,
): ClientMessage | undefined {
  let session_id: string
  try {
    session_id = sessionId()
  } catch (e) {
    return
  }

  const answer = selectAnswer(5)
  sessions[session_id].answer = answer

  const response: ClientMessage = {
    type: MsgType.session_id,
    user_id: ws.user_id,
    content: session_id,
    session_id,
  }

  log && log.log({ session_id, answer })
  join(ws, response)
}

const wordList = Object.keys(words)
export const sessions: { [key: string]: Session } = {}

function sessionId(): string {
  let id
  let tries = 0
  const MAX_TRIES = 10
  while (!id && tries++ < MAX_TRIES) {
    id = [getRand(wordList), '-', getRand(wordList)].join('')
    if (!sessions[id]) {
      sessions[id] = new Session(id)

      return id
    }
    id = undefined
  }

  throw 'no session available'
}

function selectAnswer(length = 5) {
  const filteredWordList = wordList.filter(word => word.length === length)
  return getRand(filteredWordList)
}

export function join(ws: WS, message: Message): undefined {
  if (!message || !message.session_id || !sessions[message.session_id]) {
    err(ws, `no such session id ${message.session_id}`)
    return
  }

  const response: ClientMessage = {
    type: MsgType.session_id,
    user_id: message.user_id,
  }

  // limit users to one session per user
  const userSession = Object.values(sessions).find((session: Session) =>
    session.guests.find(guest => guest.id === message.user_id),
  )

  if (!userSession) {
    sessions[message.session_id].guests.push({ id: ws.user_id } as User)
    response.session_id = message.session_id
  } else {
    response.session_id = userSession.session_id
  }

  // update ws
  ws.session_id = message.session_id
  // send session_id
  msg(ws, response)

  // replay guesses back to client
  sessions[message.session_id].guesses.forEach(guess => {
    msg(ws, { type: MsgType.guess, content: guess })
  })
}

export function guess(ws: WS, message: ServerMessage, log?: Log): undefined {
  try {
    validateResponse(message)
  } catch (e) {
    err(ws, e)
    return
  }

  if (!message.session_id) {
    err(ws, 'no session_id')
    return
  }

  const session = sessions[message.session_id]
  if (!session) {
    err(ws, 'no such session_id')
    return
  }
  const MAX_GUESSES = 20
  if (session.guesses.length >= MAX_GUESSES) {
    endSession(ws, 'no more guesses')
    return
  }

  const guess = wordToRow(message.content as string)
  evaluateGuess(guess, wordToRow(session.answer))
  session.guesses.push(guess)

  // broadcast guess to session guests
  const sessionGuests = getGuests(session)
  const response: ClientMessage = {
    type: ClientMsgType.guess,
    content: guess,
  }

  const correct = isCorrect(guess)

  sessionGuests.forEach(guest => {
    // update client
    msg(guest, response)

    // check win condition
    if (correct) {
      const winMsg = {
        ...message,
        type: ClientMsgType.again,
        content: `${chalk.greenBright('correct! winner: ')}${ws.user_id}`,
      }

      msg(guest, winMsg)
      // TODO: rm
      remove(guest, log)
    }
  })
}

function endSession(cnx: WS, message: string) {
  if (!cnx.session_id) return
  const session = sessions[cnx.session_id]
  if (!session) {
    err(cnx, message)
    // still boot the connection
    remove(cnx)
    return
  }

  // boot all session guests from server
  const guests = getGuests(session)
  guests.forEach(guest => {
    err(guest, message)
    remove(guest)
  })
}

function getGuests(session: Session) {
  const sessionGuests: WS[] = []
  wss.clients.forEach((client: WS) => {
    if (
      session.guests.find(guest => {
        return guest.id === client.user_id
      })
    ) {
      sessionGuests.push(client)
    }
  })
  return sessionGuests
}
