import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';

import type { FetchLike } from '../../src/api/http';

/**
 * Real HTTP transport for tests. The jest-expo preset replaces global `fetch` with a mock,
 * so tests that talk to the real backend inject this one. It honours the AbortSignal the
 * client uses for its timeout.
 */
export const nodeFetch: FetchLike = (url, init) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string> | undefined },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          const status = res.statusCode ?? 0;
          const body = status === 204 ? null : Buffer.concat(chunks).toString('utf8');
          resolve(new Response(body, { status, headers }));
        });
        res.on('error', reject);
      },
    );
    init.signal?.addEventListener('abort', () => {
      req.destroy();
      reject(new Error('aborted'));
    });
    req.on('error', reject);
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });

export type RunningBackend = Readonly<{ baseUrl: string; stop: () => Promise<void> }>;

/**
 * Starts the real teaching backend (course-backend/server.mjs) on a free port chosen by the OS.
 * Each test file gets its own process, so the in-memory state starts clean.
 */
export function startCourseBackend(): Promise<RunningBackend> {
  const child: ChildProcess = spawn(process.execPath, [join(__dirname, '..', '..', 'course-backend', 'server.mjs')], {
    env: { ...process.env, COURSE_BACKEND_HOST: '127.0.0.1', COURSE_BACKEND_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('course backend did not start')), 10000);
    child.once('error', reject);
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /listening at (http:\/\/[^\s]+)/.exec(chunk.toString());
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolve({
        baseUrl: match[1],
        stop: () =>
          new Promise<void>((done) => {
            child.once('exit', () => done());
            child.kill();
          }),
      });
    });
  });
}
