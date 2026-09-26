// Operator-only (Kim): host an event's finished montage (Story 2.3, AD-7).
//
//   npm run montage:upload -- <eventId> <file.mp4|.mov|.webm>
//
// Streams the file to R2 (or local Supabase storage) with a signed PUT under a
// fresh key, events/<eventId>/montage/<timestamp>.<ext>, and only after the
// PUT succeeds points events.montage_key at it. Any failure leaves the current
// montage untouched and exits 1. A replaced montage's old object is kept.
//
// Runs on the operator's machine only, with server credentials (service role,
// R2 keys) read from a gitignored env file via `node --env-file…` — see
// supabase/functions/.env.example. Nothing under scripts/ is imported by the
// app, so none of it can reach the client bundle.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { AwsClient } from 'aws4fetch'
import { createClient } from '@supabase/supabase-js'
import { withExpiry } from '../supabase/functions/_shared/view-rules.ts'
import {
  formatBytes,
  MAX_MONTAGE_BYTES,
  montageKey,
  objectUrl,
  parseArgs,
  PUT_URL_TTL_SECONDS,
  readMontageEnv,
  USAGE,
} from './montage-rules.ts'

const ENV_HINT =
  'Set them in supabase/functions/.env (local) or supabase/functions/.env.production (prod) — see supabase/functions/.env.example.'

/** Pull S3's <Code> out of an XML error body (never echo the whole body: it can carry the request URL). */
function s3Code(body: string): string | null {
  return /<Code>([^<]{1,64})<\/Code>/.exec(body)?.[1] ?? null
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.message)
    console.error(USAGE)
    return 1
  }
  const { eventId, file, contentType } = args.value

  const env = readMontageEnv(process.env)
  if (!env.ok) {
    console.error(`Missing ${env.missing.join(', ')}.`)
    console.error(ENV_HINT)
    return 1
  }
  const cfg = env.value

  let size: number
  try {
    const info = await stat(file)
    if (!info.isFile()) {
      console.error(`"${file}" isn't a file.`)
      return 1
    }
    size = info.size
  } catch {
    console.error(`Can't read "${file}".`)
    return 1
  }
  if (size === 0) {
    console.error(`"${file}" is empty.`)
    return 1
  }
  if (size > MAX_MONTAGE_BYTES) {
    console.error(`"${file}" is ${formatBytes(size)}; a single upload tops out under 5 GB. Export a smaller cut.`)
    return 1
  }

  const db = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data: event, error: eventErr } = await db.from('events').select('id').eq('id', eventId).maybeSingle()
  if (eventErr) {
    console.error(`Couldn't reach the database: ${eventErr.message}`)
    return 1
  }
  if (!event) {
    console.error(`No event ${eventId}. Check the id (it's the one in the couple's /reveal/<eventId> link).`)
    return 1
  }

  const key = montageKey(eventId, args.value.ext, new Date())
  const aws = new AwsClient({
    accessKeyId: cfg.r2AccessKeyId,
    secretAccessKey: cfg.r2SecretAccessKey,
    service: 's3',
    region: cfg.r2Region,
  })
  // Content-Type and Content-Length are signed, like the guests' uploads.
  const headers = { 'content-type': contentType, 'content-length': String(size) }
  const signed = await aws.sign(withExpiry(objectUrl(cfg.r2Endpoint, cfg.r2Bucket, key), PUT_URL_TTL_SECONDS), {
    method: 'PUT',
    headers,
    aws: { signQuery: true, allHeaders: true },
  })

  console.log(`Uploading ${file} (${formatBytes(size)}) for event ${eventId}…`)
  const source = createReadStream(file)
  if (process.stdout.isTTY) {
    let sent = 0
    let shown = -1
    source.on('data', (chunk) => {
      sent += chunk.length
      const pct = Math.floor((sent / size) * 10) * 10
      if (pct !== shown) {
        shown = pct
        process.stdout.write(`\r  ${pct}%`)
      }
    })
    source.on('end', () => process.stdout.write('\n'))
  }

  let res: Response
  try {
    res = await fetch(signed.url, {
      method: 'PUT',
      headers,
      body: Readable.toWeb(source) as ReadableStream,
      duplex: 'half', // required by Node's fetch for a streamed body
    })
  } catch (error) {
    source.destroy()
    console.error(`Upload failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error('The montage was not changed.')
    return 1
  }
  if (!res.ok) {
    source.destroy()
    const code = s3Code(await res.text().catch(() => ''))
    console.error(`Upload failed: storage answered ${res.status}${code ? ` (${code})` : ''}.`)
    console.error('The montage was not changed.')
    return 1
  }

  const { data: updated, error: updateErr } = await db
    .from('events')
    .update({ montage_key: key })
    .eq('id', eventId)
    .select('id')
  if (updateErr || updated?.length !== 1) {
    console.error(`Uploaded to ${key}, but couldn't point the event at it${updateErr ? `: ${updateErr.message}` : '.'}`)
    console.error('The couple still sees the previous montage (if any). Run the upload again.')
    return 1
  }

  console.log(`Montage hosted for event ${eventId}.`)
  console.log(`  key: ${key}`)
  console.log('The couple will see it the next time they open their reveal.')
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)
