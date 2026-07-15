import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from './require-return-reply-send.mjs';

// RuleTester emits its cases through describe/it when they are provided. Vitest does not expose
// them as globals by default (no `globals: true`), so hand them over explicitly — otherwise
// RuleTester runs its assertions at import time and the file collects zero tests.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('require-return-reply-send', rule, {
  valid: [
    // Acknowledged: the handler's promise waits on the reply thenable (eos) before resolving, so
    // reply.sent is true by the time wrap-thenable's guard runs.
    'app.get("/x", async (req, reply) => { return reply.send({ a: 1 }); });',
    'app.get("/x", async (req, reply) => { return reply.code(200).send({ a: 1 }); });',
    'app.get("/x", async (req, reply) => { await reply.send({ a: 1 }); });',
    // A helper that must still resolve undefined to signal "already answered" to its caller.
    'async function p(req, reply) { await reply.code(401).send({ e: 1 }); return; }',
    // Arrow implicit return.
    'app.get("/x", async (req, reply) => reply.send({ a: 1 }));',

    // SYNCHRONOUS handlers never reach wrap-thenable, so an unreturned send cannot be re-sent.
    // These are the real app.ts setNotFoundHandler / error-handler.ts shapes and must stay clean.
    'app.setNotFoundHandler((req, reply) => { reply.code(404).send({ e: 1 }); });',
    'app.setNotFoundHandler((req, reply) => { void reply.code(404).send({ e: 1 }); return; });',
    'app.setErrorHandler((err, req, reply) => { void reply.code(500).send({ e: 1 }); });',

    // Not a reply: an unrelated object that happens to expose send().
    'app.get("/x", async (req, reply) => { socket.send("hi"); return reply.send({ a: 1 }); });',
    'app.get("/x", async (req, reply) => { queue.code(1).send("hi"); return reply.send({ a: 1 }); });',
  ],

  invalid: [
    {
      // The exact shape that shipped empty bodies on /api/sync/pull.
      code: 'app.get("/x", async (req, reply) => { reply.send({ a: 1 }); });',
      errors: [{ messageId: 'unreturned' }],
    },
    {
      code: 'app.get("/x", async (req, reply) => { reply.code(200).send({ a: 1 }); });',
      errors: [{ messageId: 'unreturned' }],
    },
    {
      code: 'app.get("/x", async (req, reply) => { reply.header("x", "1").code(200).send({ a: 1 }); });',
      errors: [{ messageId: 'unreturned' }],
    },
    {
      // `void` is not an acknowledgement — it discards the thenable without awaiting.
      code: 'app.get("/x", async (req, reply) => { void reply.send({ a: 1 }); });',
      errors: [{ messageId: 'voided' }],
    },
    {
      // Returned, but `void` still makes it resolve to undefined.
      code: 'app.get("/x", async (req, reply) => { return void reply.send({ a: 1 }); });',
      errors: [{ messageId: 'voided' }],
    },
    {
      // An async helper is at risk too: its caller's bare `return` resolves the handler.
      code: 'async function p(req, reply) { reply.code(401).send({ e: 1 }); return; }',
      errors: [{ messageId: 'unreturned' }],
    },
    {
      // The nearest enclosing function is what Fastify re-sends: a send in a nested async callback
      // is judged against that callback, not the outer sync one.
      code: 'app.get("/x", (req, reply) => { items.forEach(async () => { reply.send({ a: 1 }); }); });',
      errors: [{ messageId: 'unreturned' }],
    },
    {
      // `res` is honoured as a reply name too.
      code: 'app.get("/x", async (req, res) => { res.send({ a: 1 }); });',
      errors: [{ messageId: 'unreturned' }],
    },
  ],
});
