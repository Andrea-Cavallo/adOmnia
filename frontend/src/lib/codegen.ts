import type { RequestItem } from '@/lib/types'

export type CodeLang =
  | 'curl'
  | 'javascript-fetch'
  | 'node-http'
  | 'python-requests'
  | 'go'
  | 'php'
  | 'csharp'
  | 'java-okhttp'
  | 'ruby-nethttp'
  | 'rust-reqwest'
  | 'swift-urlsession'
  | 'kotlin-okhttp'
  | 'shell-wget'

interface CodeLangDef {
  id: CodeLang
  label: string
  ext: string
}

export const LANGUAGES: CodeLangDef[] = [
  { id: 'curl', label: 'cURL', ext: 'sh' },
  { id: 'javascript-fetch', label: 'JavaScript (fetch)', ext: 'js' },
  { id: 'node-http', label: 'Node.js (http)', ext: 'js' },
  { id: 'python-requests', label: 'Python (requests)', ext: 'py' },
  { id: 'go', label: 'Go (net/http)', ext: 'go' },
  { id: 'php', label: 'PHP (curl)', ext: 'php' },
  { id: 'csharp', label: 'C# (HttpClient)', ext: 'cs' },
  { id: 'java-okhttp', label: 'Java (OkHttp)', ext: 'java' },
  { id: 'ruby-nethttp', label: 'Ruby (Net::HTTP)', ext: 'rb' },
  { id: 'rust-reqwest', label: 'Rust (reqwest)', ext: 'rs' },
  { id: 'swift-urlsession', label: 'Swift (URLSession)', ext: 'swift' },
  { id: 'kotlin-okhttp', label: 'Kotlin (OkHttp)', ext: 'kt' },
  { id: 'shell-wget', label: 'Shell (wget)', ext: 'sh' },
]

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeSingleQuoted(s: string): string {
  return s.replace(/'/g, "'\\''")
}

function headersObj(req: RequestItem): Record<string, string> {
  const h: Record<string, string> = {}
  for (const row of req.headers) {
    if (row.enabled && row.key) {
      h[row.key] = row.value
    }
  }
  return h
}

function bodyString(req: RequestItem): string | null {
  const body = req.bodies[req.activeBodyIdx]
  if (!body || body.type === 'none') return null
  return body.raw
}

function queryString(req: RequestItem): string {
  const params = req.params.filter((p) => p.enabled && p.key)
  if (!params.length) return ''
  const parts = params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
  return parts.join('&')
}

function fullUrl(req: RequestItem): string {
  const qs = queryString(req)
  if (!qs) return req.url
  return req.url.includes('?') ? `${req.url}&${qs}` : `${req.url}?${qs}`
}

// --- Generators ---

function genCurl(req: RequestItem): string {
  const parts: string[] = ['curl']
  if (req.method !== 'GET') {
    parts.push(`-X ${req.method}`)
  }
  for (const [k, v] of Object.entries(headersObj(req))) {
    parts.push(`-H '${escapeSingleQuoted(k)}: ${escapeSingleQuoted(v)}'`)
  }
  const body = bodyString(req)
  if (body) {
    parts.push(`-d '${escapeSingleQuoted(body)}'`)
  }
  parts.push(`'${escapeSingleQuoted(fullUrl(req))}'`)
  return parts.join(' \\\n  ')
}

function genJsFetch(req: RequestItem): string {
  const lines: string[] = []
  const headers = headersObj(req)
  const hasHeaders = Object.keys(headers).length > 0
  const body = bodyString(req)

  lines.push(`fetch('${escapeQuoted(fullUrl(req))}', {`)
  lines.push(`  method: '${req.method}',`)
  if (hasHeaders) {
    lines.push('  headers: {')
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`    '${escapeQuoted(k)}': '${escapeQuoted(v)}',`)
    }
    lines.push('  },')
  }
  if (body) {
    lines.push(`  body: '${escapeQuoted(body)}',`)
  }
  lines.push('})')
  lines.push('  .then(res => res.json())')
  lines.push('  .then(data => console.log(data))')
  lines.push('  .catch(err => console.error(err));')
  return lines.join('\n')
}

function genNodeHttp(req: RequestItem): string {
  const lines: string[] = []
  const url = new URL(fullUrl(req))
  const body = bodyString(req)

  lines.push("const https = require('https');")
  lines.push("const http = require('http');")
  lines.push('')
  lines.push(`const options = {`)
  lines.push(`  hostname: '${url.hostname}',`)
  lines.push(`  port: ${url.port || (url.protocol === 'https:' ? '443' : '80')},`)
  lines.push(`  path: '${escapeQuoted(url.pathname + url.search)}',`)
  lines.push(`  method: '${req.method}',`)
  const headers = headersObj(req)
  if (Object.keys(headers).length > 0) {
    lines.push('  headers: {')
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`    '${escapeQuoted(k)}': '${escapeQuoted(v)}',`)
    }
    lines.push('  },')
  }
  lines.push('};')
  lines.push('')
  lines.push(`const client = ${url.protocol === 'https:' ? 'https' : 'http'};`)
  lines.push('const req = client.request(options, (res) => {')
  lines.push('  let data = "";')
  lines.push('  res.on("data", (chunk) => { data += chunk; });')
  lines.push('  res.on("end", () => console.log(data));')
  lines.push('});')
  lines.push('req.on("error", (err) => console.error(err));')
  if (body) {
    lines.push(`req.write('${escapeQuoted(body)}');`)
  }
  lines.push('req.end();')
  return lines.join('\n')
}

function genPythonRequests(req: RequestItem): string {
  const lines: string[] = ['import requests', '']
  const headers = headersObj(req)
  const body = bodyString(req)

  if (Object.keys(headers).length > 0) {
    lines.push(`headers = {`)
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`    "${escapeQuoted(k)}": "${escapeQuoted(v)}",`)
    }
    lines.push('}')
    lines.push('')
  }
  if (body) {
    lines.push(`data = '${escapeQuoted(body)}'`)
    lines.push('')
  }

  const args: string[] = [`"${escapeQuoted(fullUrl(req))}"`]
  if (Object.keys(headers).length > 0) args.push('headers=headers')
  if (body) args.push(`data=data`)

  lines.push(`response = requests.${req.method.toLowerCase()}(${args.join(', ')})`)
  lines.push('print(response.json())')
  return lines.join('\n')
}

function genGo(req: RequestItem): string {
  const lines: string[] = []
  const body = bodyString(req)

  lines.push('package main')
  lines.push('')
  lines.push('import (')
  lines.push('\t"fmt"')

  if (body) lines.push('\t"strings"')
  lines.push('\t"net/http"')
  lines.push('\t"io"')
  lines.push(')')
  lines.push('')
  lines.push('func main() {')
  if (body) {
    lines.push(`\tpayload := strings.NewReader(\`${body}\`)`)
    lines.push(`\treq, _ := http.NewRequest("${req.method}", "${escapeQuoted(fullUrl(req))}", payload)`)
  } else {
    lines.push(`\treq, _ := http.NewRequest("${req.method}", "${escapeQuoted(fullUrl(req))}", nil)`)
  }
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`\treq.Header.Add("${escapeQuoted(k)}", "${escapeQuoted(v)}")`)
  }
  lines.push('')
  lines.push('\tres, err := http.DefaultClient.Do(req)')
  lines.push('\tif err != nil {')
  lines.push('\t\tpanic(err)')
  lines.push('\t}')
  lines.push('\tdefer res.Body.Close()')
  lines.push('\tbody, _ := io.ReadAll(res.Body)')
  lines.push('\tfmt.Println(string(body))')
  lines.push('}')
  return lines.join('\n')
}

function genPhp(req: RequestItem): string {
  const lines: string[] = ['<?php', '']
  const body = bodyString(req)
  const url = fullUrl(req)

  lines.push(`$ch = curl_init();`)
  lines.push(`curl_setopt($ch, CURLOPT_URL, "${escapeQuoted(url)}");`)
  lines.push(`curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`)
  if (req.method !== 'GET') {
    lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${req.method}");`)
  }
  if (body) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${escapeQuoted(body)}');`)
  }
  const headers = headersObj(req)
  if (Object.keys(headers).length > 0) {
    const hdrList: string[] = []
    for (const [k, v] of Object.entries(headers)) {
      hdrList.push(`"${escapeQuoted(k)}: ${escapeQuoted(v)}"`)
    }
    lines.push(`curl_setopt($ch, CURLOPT_HTTPHEADER, [${hdrList.join(', ')}]);`)
  }
  lines.push('')
  lines.push('$response = curl_exec($ch);')
  lines.push('curl_close($ch);')
  lines.push('echo $response;')
  return lines.join('\n')
}

function genCSharp(req: RequestItem): string {
  const lines: string[] = []
  const body = bodyString(req)

  lines.push('using System;')
  lines.push('using System.Net.Http;')
  lines.push('using System.Threading.Tasks;')
  lines.push('')
  lines.push('class Program')
  lines.push('{')
  lines.push('    static async Task Main()')
  lines.push('    {')
  lines.push('        using var client = new HttpClient();')
  lines.push(`        var request = new HttpRequestMessage(HttpMethod.${req.method === 'GET' ? 'Get' : req.method.charAt(0) + req.method.slice(1).toLowerCase()}, "${escapeQuoted(fullUrl(req))}");`)
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`        request.Headers.TryAddWithoutValidation("${escapeQuoted(k)}", "${escapeQuoted(v)}");`)
  }
  if (body) {
    lines.push(`        request.Content = new StringContent("${escapeQuoted(body)}");`)
  }
  lines.push('')
  lines.push('        var response = await client.SendAsync(request);')
  lines.push('        var result = await response.Content.ReadAsStringAsync();')
  lines.push('        Console.WriteLine(result);')
  lines.push('    }')
  lines.push('}')
  return lines.join('\n')
}

function genJavaOkHttp(req: RequestItem): string {
  const lines: string[] = []
  const body = bodyString(req)
  const method = req.method

  lines.push('import okhttp3.*;')
  lines.push('import java.io.IOException;')
  lines.push('')
  lines.push('public class ApiClient {')
  lines.push('    public static void main(String[] args) throws IOException {')
  lines.push('        OkHttpClient client = new OkHttpClient();')
  lines.push('')
  if (body) {
    lines.push(`        MediaType mediaType = MediaType.parse("application/json");`)
    lines.push(`        RequestBody body = RequestBody.create("${escapeQuoted(body)}", mediaType);`)
  }
  lines.push('        Request.Builder builder = new Request.Builder()')
  lines.push(`            .url("${escapeQuoted(fullUrl(req))}");`)
  if (['GET', 'HEAD'].includes(method)) {
    lines.push('')
    if (body) lines.push('        builder.get();')
    else lines.push('        builder.get();')
  } else if (body) {
    lines.push(`        builder.${method.toLowerCase()}(body);`)
  } else {
    lines.push(`        builder.method("${method}", null);`)
  }
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`        builder.addHeader("${escapeQuoted(k)}", "${escapeQuoted(v)}");`)
  }
  lines.push('')
  lines.push('        try (Response response = client.newCall(builder.build()).execute()) {')
  lines.push('            System.out.println(response.body().string());')
  lines.push('        }')
  lines.push('    }')
  lines.push('}')
  return lines.join('\n')
}

function genRubyNetHttp(req: RequestItem): string {
  const lines: string[] = ["require 'uri'", "require 'net/http'", '']
  const body = bodyString(req)
  const url = fullUrl(req)

  lines.push(`url = URI("${escapeQuoted(url)}")`)
  lines.push('')
  lines.push('http = Net::HTTP.new(url.host, url.port)')
  if (url.startsWith('https')) {
    lines.push('http.use_ssl = true')
  }
  lines.push('')
  lines.push(`request = Net::HTTP::${req.method.charAt(0) + req.method.slice(1).toLowerCase()}.new(url)`)
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`request["${escapeQuoted(k)}"] = "${escapeQuoted(v)}"`)
  }
  if (body) {
    lines.push(`request.body = '${escapeQuoted(body)}'`)
  }
  lines.push('')
  lines.push('response = http.request(request)')
  lines.push('puts response.read_body')
  return lines.join('\n')
}

function genRustReqwest(req: RequestItem): string {
  const lines: string[] = []
  const body = bodyString(req)

  lines.push('use reqwest::blocking::Client;')
  lines.push('use std::collections::HashMap;')
  lines.push('')
  lines.push('fn main() -> Result<(), Box<dyn std::error::Error>> {')
  lines.push('    let client = Client::new();')
  const method = req.method.toLowerCase()
  const methodFn = body ? `.body("${escapeQuoted(body)}")` : ''
  lines.push(`    let response = client.${method}("${escapeQuoted(fullUrl(req))}")`)
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`        .header("${escapeQuoted(k)}", "${escapeQuoted(v)}")`)
  }
  lines.push(`        ${methodFn}`)
  lines.push('        .send()?;')
  lines.push('')
  lines.push('    println!("{}", response.text()?);')
  lines.push('    Ok(())')
  lines.push('}')
  return lines.join('\n')
}

function genSwiftUrlSession(req: RequestItem): string {
  const lines: string[] = ['import Foundation', '']
  const body = bodyString(req)

  lines.push(`let url = URL(string: "${escapeQuoted(fullUrl(req))}")!`)
  lines.push('var request = URLRequest(url: url)')
  lines.push(`request.httpMethod = "${req.method}"`)
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`request.setValue("${escapeQuoted(v)}", forHTTPHeaderField: "${escapeQuoted(k)}")`)
  }
  if (body) {
    lines.push(`request.httpBody = "${escapeQuoted(body)}".data(using: .utf8)`)
  }
  lines.push('')
  lines.push('let task = URLSession.shared.dataTask(with: request) { data, response, error in')
  lines.push('    if let error = error {')
  lines.push('        print(error)')
  lines.push('        return')
  lines.push('    }')
  lines.push('    if let data = data, let body = String(data: data, encoding: .utf8) {')
  lines.push('        print(body)')
  lines.push('    }')
  lines.push('}')
  lines.push('task.resume()')
  return lines.join('\n')
}

function genKotlinOkHttp(req: RequestItem): string {
  const lines: string[] = []
  const body = bodyString(req)
  const method = req.method

  lines.push('import okhttp3.*')
  lines.push('import java.io.IOException')
  lines.push('')
  lines.push('fun main() {')
  lines.push('    val client = OkHttpClient()')
  lines.push('')
  if (body) {
    lines.push(`    val mediaType = "application/json".toMediaTypeOrNull()`)
    lines.push(`    val body = RequestBody.create(mediaType, "${escapeQuoted(body)}")`)
  }
  lines.push('    val request = Request.Builder()')
  lines.push(`        .url("${escapeQuoted(fullUrl(req))}")`)
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    lines.push(`        .${method.toLowerCase()}(body)`)
  } else if (body) {
    lines.push(`        .method("${method}", body)`)
  } else {
    lines.push(`        .method("${method}", null)`)
  }
  for (const [k, v] of Object.entries(headersObj(req))) {
    lines.push(`        .addHeader("${escapeQuoted(k)}", "${escapeQuoted(v)}")`)
  }
  lines.push('        .build()')
  lines.push('')
  lines.push('    client.newCall(request).execute().use { response ->')
  lines.push('        println(response.body?.string())')
  lines.push('    }')
  lines.push('}')
  return lines.join('\n')
}

function genShellWget(req: RequestItem): string {
  const parts: string[] = ['wget']
  parts.push('--quiet')
  if (req.method !== 'GET') {
    parts.push(`--method=${req.method}`)
  }
  for (const [k, v] of Object.entries(headersObj(req))) {
    parts.push(`--header='${escapeSingleQuoted(k)}: ${escapeSingleQuoted(v)}'`)
  }
  const body = bodyString(req)
  if (body) {
    parts.push(`--body-data='${escapeSingleQuoted(body)}'`)
  }
  parts.push(`-O - '${escapeSingleQuoted(fullUrl(req))}'`)
  return parts.join(' \\\n  ')
}

const GENERATORS: Record<CodeLang, (req: RequestItem) => string> = {
  'curl': genCurl,
  'javascript-fetch': genJsFetch,
  'node-http': genNodeHttp,
  'python-requests': genPythonRequests,
  'go': genGo,
  'php': genPhp,
  'csharp': genCSharp,
  'java-okhttp': genJavaOkHttp,
  'ruby-nethttp': genRubyNetHttp,
  'rust-reqwest': genRustReqwest,
  'swift-urlsession': genSwiftUrlSession,
  'kotlin-okhttp': genKotlinOkHttp,
  'shell-wget': genShellWget,
}

export function generateCode(req: RequestItem, lang: CodeLang): string {
  const gen = GENERATORS[lang]
  if (!gen) return ''
  return gen(req)
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
