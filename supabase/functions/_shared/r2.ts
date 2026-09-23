// R2 (S3-compatible) access for Edge Functions only — creds never leave here.
// Deno-only (npm: import); not imported by the client's vitest suite.
import { AwsClient } from 'npm:aws4fetch@1'

export const PUT_TTL_SECONDS = 300 // signed upload URLs live 5 minutes

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Missing ${name}`)
  return v
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: Deno.env.get('R2_REGION') ?? 'auto',
  })
}

function objectUrl(endpoint: string, key: string): string {
  return `${endpoint.replace(/\/$/, '')}/${env('R2_BUCKET')}/${key}`
}

/**
 * Presign a PUT for one object key. Content-Type and Content-Length are signed
 * headers (allHeaders), so the URL only accepts exactly the declared type and
 * byte size — the size cap can't be bypassed by uploading a bigger body.
 */
export async function presignPut(key: string, contentType: string, size: number): Promise<string> {
  const url = `${objectUrl(env('R2_ENDPOINT'), key)}?X-Amz-Expires=${PUT_TTL_SECONDS}`
  const signed = await client().sign(url, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(size) },
    aws: { signQuery: true, allHeaders: true },
  })
  return signed.url
}

/**
 * Does the object exist in the bucket? Server-side check before a shot is
 * marked uploaded. R2_SERVER_ENDPOINT overrides R2_ENDPOINT for local dev,
 * where the function's container can't reach the host's 127.0.0.1.
 */
export async function objectExists(key: string): Promise<boolean> {
  const endpoint = Deno.env.get('R2_SERVER_ENDPOINT') ?? env('R2_ENDPOINT')
  const res = await client().fetch(objectUrl(endpoint, key), { method: 'HEAD' })
  if (res.ok) return true
  if (res.status === 404) return false
  throw new Error(`Storage HEAD failed (${res.status})`)
}
