import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { basename, extname, join } from 'node:path'

const baseUrl = process.env.LUCARICE_URL ?? 'http://127.0.0.1:6006'
const inputDir = requiredEnv('BENCHMARK_INPUT_DIR')
const imageRoot = requiredEnv('BENCHMARK_IMAGE_ROOT')
const outputDir = requiredEnv('BENCHMARK_OUTPUT_DIR')
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? '10')
const limit = Number(process.env.BENCHMARK_LIMIT ?? '0')
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? '480000')
const sessionToken = requiredEnv('LUCARICE_SESSION_TOKEN')

if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('BENCHMARK_CONCURRENCY must be a positive integer')
if (!Number.isInteger(limit) || limit < 0) throw new Error('BENCHMARK_LIMIT must be a non-negative integer')

const answersPath = join(outputDir, 'answers.jsonl')
const reportPath = join(outputDir, 'report.json')
const questionAbort = new AbortController()
const followUps = new Map()

function requiredEnv(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function authenticatedHeaders(extra = {}) {
  return { cookie: `lucarice_session=${sessionToken}`, ...extra }
}

function fieldValue(record, name) {
  const match = new RegExp(`^"${name}":\\s*"((?:\\\\.|[^"\\\\])*)"`, 'm').exec(record)
  if (match?.[1] === undefined) throw new Error(`record is missing ${name}`)
  return JSON.parse(`"${match[1]}"`)
}

function recordsFromMarkdown(source, file) {
  const matches = [...source.matchAll(/^\{[\s\S]*?^\}\r?$/gm)]
  if (matches.length === 0) throw new Error(`${file} contains no records`)
  return matches.map((match, index) => {
    const record = match[0]
    const question = fieldValue(record, 'question')
    const imageField = fieldValue(record, 'Qimages')
    const images = imageField === '' ? [] : imageField.split(/\s+/)
    return { file, index, source: record, question, images }
  })
}

function mediaType(image) {
  switch (extname(image).toLowerCase()) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}

async function rpc(method, payload) {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: authenticatedHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  })
  if (!response.ok) throw new Error(`${method} transport failure: HTTP ${response.status}`)
  const body = await response.json()
  if (!body.result?.ok) throw new Error(`${method} failed: ${body.result?.error?.code ?? 'unknown'}: ${body.result?.error?.message ?? 'unknown error'}`)
  return body.result.value
}

async function answerQuestion(frame) {
  const { sessionId, questions } = frame.payload
  const response = {
    type: 'client-response',
    rpcId: frame.rpcId,
    result: {
      ok: true,
      value: {
        sessionId,
        answer: {
          answers: questions.map(question => ({ id: question.id, selected: [], custom: '不清楚' })),
        },
      },
    },
  }
  const receipt = await fetch(`${baseUrl}/api/respond`, {
    method: 'POST',
    headers: authenticatedHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(response),
  })
  if (!receipt.ok) throw new Error(`question response transport failure: HTTP ${receipt.status}`)
  const body = await receipt.json()
  if (body.accepted !== true) throw new Error(`question response was not accepted: ${body.reason ?? 'unknown'}`)
  followUps.set(sessionId, (followUps.get(sessionId) ?? 0) + 1)
}

function watchQuestions() {
  const url = new URL(baseUrl)
  const port = url.port === '' ? 80 : Number(url.port)
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const done = new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port })
    let handshake = Buffer.alloc(0)
    let frames = Buffer.alloc(0)
    let upgraded = false
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (!upgraded) error === undefined ? readyResolve() : readyReject(error)
      error === undefined ? resolve() : reject(error)
    }
    const consumeFrames = () => {
      while (frames.length >= 2) {
        const first = frames[0]
        const second = frames[1]
        const lengthTag = second & 0x7f
        let offset = 2
        let length = lengthTag
        if (lengthTag === 126) {
          if (frames.length < 4) return
          length = frames.readUInt16BE(2)
          offset = 4
        } else if (lengthTag === 127) {
          if (frames.length < 10) return
          const longLength = frames.readBigUInt64BE(2)
          if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('question frame is too large')
          length = Number(longLength)
          offset = 10
        }
        if (frames.length < offset + length) return
        const payload = frames.subarray(offset, offset + length)
        frames = frames.subarray(offset + length)
        const opcode = first & 0x0f
        if (opcode === 8) {
          socket.end()
          return
        }
        if (opcode !== 1) continue
        const frame = JSON.parse(payload.toString('utf8'))
        if (frame.type === 'server-request' && frame.payload?.type === 'question/requested') {
          void answerQuestion(frame).catch(finish)
        }
      }
    }
    socket.once('connect', () => {
      const key = randomBytes(16).toString('base64')
      socket.write([
        'GET /api/events.mux HTTP/1.1',
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Cookie: lucarice_session=${sessionToken}`,
        '',
        '',
      ].join('\r\n'))
    })
    socket.on('data', data => {
      try {
        if (!upgraded) {
          handshake = Buffer.concat([handshake, data])
          const boundary = handshake.indexOf('\r\n\r\n')
          if (boundary === -1) return
          const status = handshake.subarray(0, boundary).toString('utf8').split('\r\n', 1)[0]
          if (!status?.includes(' 101 ')) throw new Error(`question stream upgrade failed: ${status ?? 'missing status'}`)
          upgraded = true
          readyResolve()
          frames = handshake.subarray(boundary + 4)
        } else {
          frames = Buffer.concat([frames, data])
        }
        consumeFrames()
      } catch (error) {
        socket.destroy()
        finish(error)
      }
    })
    socket.on('error', error => { if (questionAbort.signal.aborted) finish(); else finish(error) })
    socket.on('close', () => {
      if (questionAbort.signal.aborted) finish()
      else finish(new Error('question stream closed unexpectedly'))
    })
    questionAbort.signal.addEventListener('abort', () => socket.destroy(), { once: true })
  })
  return { ready, done }
}

function finalAnswer(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index].event
    if (event.type !== 'assistant/message') continue
    const blocks = event.data?.message?.content
    if (!Array.isArray(blocks)) continue
    const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
    if (text !== '') return text
  }
  throw new Error('completed session has no assistant text')
}

async function waitForAnswer(sessionId) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 100 })
    const completed = [...history.events].reverse().find(entry => entry.event.type === 'turn/end')
    if (completed !== undefined) {
      const reason = completed.event.data?.reason?.kind
      if (reason !== 'completed') throw new Error(`turn ended as ${reason ?? 'unknown'}`)
      return finalAnswer(history.events)
    }
    await sleep(1200)
  }
  throw new Error(`timed out after ${timeoutMs}ms`)
}

async function answerTask(task) {
  const startedAt = Date.now()
  const created = await rpc('session.create', { agentPreset: 'rice-chat' })
  const content = []
  for (const image of task.images) {
    const imagePath = join(imageRoot, image)
    const data = await readFile(imagePath)
    content.push({ type: 'image', mediaType: mediaType(image), data: data.toString('base64'), name: basename(image) })
  }
  content.push({ type: 'text', text: task.question })
  await rpc('session.prompt', { sessionId: created.sessionId, mode: 'queue', content })
  const answer = await waitForAnswer(created.sessionId)
  return {
    key: `${task.file}:${task.index}`,
    file: task.file,
    index: task.index,
    sessionId: created.sessionId,
    answer,
    followUps: followUps.get(created.sessionId) ?? 0,
    durationMs: Date.now() - startedAt,
  }
}

async function readExistingAnswers() {
  try {
    const source = await readFile(answersPath, 'utf8')
    return new Map(source.split('\n').filter(Boolean).map(line => {
      const answer = JSON.parse(line)
      return [answer.key, answer]
    }))
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map()
    throw error
  }
}

function addAnswer(record, answer) {
  const withoutOld = record.replace(/(?:\r?\n){1,2}"(?:LucaRice|LuckRice)":\s*"(?:\\.|[^"\\])*"(?=\r?\n|$)/g, '')
  const gptAtEnd = /(\r?\n"gpt":\s*"(?:\\.|[^"\\])*")(\r?\n\})$/.exec(withoutOld)
  if (gptAtEnd === null) throw new Error('record does not end with gpt')
  return `${withoutOld.slice(0, gptAtEnd.index)}${gptAtEnd[1]}\n\n"LuckRice": ${JSON.stringify(answer)}${gptAtEnd[2]}`
}

async function writeCompletedMarkdown(files, answers) {
  for (const file of files) {
    const source = await readFile(join(inputDir, file), 'utf8')
    const matches = [...source.matchAll(/^\{[\s\S]*?^\}\r?$/gm)]
    let cursor = 0
    let rendered = ''
    for (const [index, match] of matches.entries()) {
      const key = `${file}:${index}`
      const result = answers.get(key)
      if (result === undefined) throw new Error(`missing answer for ${key}`)
      rendered += source.slice(cursor, match.index) + addAnswer(match[0], result.answer)
      cursor = match.index + match[0].length
    }
    rendered += source.slice(cursor)
    await writeFile(join(outputDir, file), rendered)
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const files = (await readdir(inputDir)).filter(file => file.endsWith('.md')).sort()
  const tasks = []
  for (const file of files) {
    const source = await readFile(join(inputDir, file), 'utf8')
    tasks.push(...recordsFromMarkdown(source, file))
  }
  const existing = await readExistingAnswers()
  const selected = limit === 0 ? tasks : tasks.slice(0, limit)
  const pending = selected.filter(task => !existing.has(`${task.file}:${task.index}`))
  const stream = watchQuestions()
  await stream.ready
  let next = 0
  const failures = []
  async function worker() {
    while (true) {
      const task = pending[next++]
      if (task === undefined) return
      try {
        const result = await answerTask(task)
        existing.set(result.key, result)
        await appendFile(answersPath, `${JSON.stringify(result)}\n`)
        process.stdout.write(`done ${existing.size}/${selected.length} ${result.file}:${result.index} followups=${result.followUps}\n`)
      } catch (error) {
        failures.push({ key: `${task.file}:${task.index}`, message: error instanceof Error ? error.message : String(error) })
        process.stderr.write(`failed ${task.file}:${task.index} ${failures.at(-1).message}\n`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()))
  questionAbort.abort()
  await stream.done.catch(error => {
    if (error?.name !== 'AbortError') throw error
  })
  const report = {
    total: tasks.length,
    selected: selected.length,
    completed: existing.size,
    failures,
    completedAt: new Date().toISOString(),
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (limit === 0 && failures.length === 0 && existing.size === tasks.length) await writeCompletedMarkdown(files, existing)
  console.log(JSON.stringify(report))
  if (failures.length > 0) process.exitCode = 1
}

await main()
