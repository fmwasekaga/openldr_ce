/**
 * Require `return` or `await` on a `reply.send(...)` inside an async function.
 *
 * WHY THIS RULE EXISTS
 *
 * buildApp registers @fastify/compress globally (sync S7-B). Any payload over the 1024-byte
 * threshold is written through an ASYNC gzip stream, so nothing has been written to the socket
 * yet at the moment an async handler's promise resolves.
 *
 * Fastify 5 hands every thenable handler to lib/wrap-thenable.js, which re-sends the resolved
 * value:
 *
 *     if (payload !== undefined ||
 *         (reply.sent === false && reply.raw.headersSent === false && ...)) {
 *       reply.send(payload)
 *     }
 *
 * With a bare `reply.send(big)` the handler resolves to `undefined`, and because the gzip stream
 * has not written yet, `reply.sent` (a.k.a. raw.writableEnded) is still false. Both clauses fall
 * through and Fastify calls `reply.send(undefined)` — clobbering the real body. The client gets
 * correct headers (`content-encoding: gzip`) with `content-length: 0` and a gunzip error.
 *
 * `return`ing or `await`ing is what actually prevents this, and the reason is subtler than it
 * looks: a Fastify Reply is THENABLE (Reply.prototype.then), so `return reply.send(x)` from an
 * async function makes the promise ADOPT the reply, and Reply.prototype.then only calls
 * `fulfilled()` after `eos(this.raw)` — end-of-stream. The handler's promise therefore does not
 * resolve until the response is fully flushed, by which point `reply.sent === true` and the guard's
 * second clause is false. (Note it resolves to `undefined`, not to the reply — safety comes from
 * the eos wait, not from a non-undefined payload.) `await reply.send(x)` awaits the very same
 * thenable and is exactly as safe.
 *
 * `void reply.send(x)` is NOT an acknowledgement: `void` discards the thenable without awaiting it,
 * so the handler resolves `undefined` immediately — identical to a bare send, and identically broken.
 *
 * This is invisible to unit tests whose fixtures are sub-threshold, and it stayed invisible even to
 * a test driving the real buildApp. Only a real-HTTP acceptance harness caught it. Hence a lint rule.
 *
 * SCOPE: async functions only. A synchronous handler that returns undefined never reaches
 * wrap-thenable, so `void reply.code(404).send(...)` in a sync setNotFoundHandler/setErrorHandler is
 * genuinely safe and is not flagged.
 */

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/**
 * Resolve the root identifier of a member/call chain, so that both `reply.send(x)` and
 * `reply.header(..).code(400).send(x)` resolve to the identifier `reply`.
 */
function chainRoot(node) {
  let current = node;
  for (;;) {
    if (current.type === 'MemberExpression') current = current.object;
    else if (current.type === 'CallExpression') current = current.callee;
    else return current;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require return/await on reply.send() inside an async function, so a globally-registered ' +
        'compression stream cannot let Fastify re-send undefined over the real body.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          replyNames: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unreturned:
        'Unreturned `{{name}}.send(...)` in an async function: the handler resolves to undefined ' +
        'before the gzip stream writes, so Fastify re-sends undefined and the real body is lost ' +
        '(empty body above ~1KB). Use `return {{name}}.send(...)`, or `await {{name}}.send(...)` if ' +
        'the function must resolve to something else.',
      voided:
        '`void {{name}}.send(...)` in an async function is exactly as unsafe as a bare send — `void` ' +
        'discards the thenable without awaiting, so the handler still resolves to undefined and ' +
        'Fastify re-sends undefined over the real body. Use `return`/`await` instead of `void`.',
    },
  },

  create(context) {
    const replyNames = new Set(context.options[0]?.replyNames ?? ['reply', 'res']);
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Nearest enclosing function — the one whose resolved value Fastify would re-send. */
    function nearestFunction(node) {
      const ancestors = sourceCode.getAncestors ? sourceCode.getAncestors(node) : context.getAncestors();
      for (let i = ancestors.length - 1; i >= 0; i -= 1) {
        if (FUNCTION_TYPES.has(ancestors[i].type)) return ancestors[i];
      }
      return null;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'send') return;

        const root = chainRoot(callee.object);
        if (root.type !== 'Identifier' || !replyNames.has(root.name)) return;

        // Only an async function's resolved value reaches wrap-thenable.
        const fn = nearestFunction(node);
        if (!fn || !fn.async) return;

        const parent = node.parent;

        // `void reply.send(x)` — reported before the acknowledgement checks, so that even a
        // `return void reply.send(x)` is caught: it returns undefined just the same.
        if (parent.type === 'UnaryExpression' && parent.operator === 'void') {
          context.report({ node: parent, messageId: 'voided', data: { name: root.name } });
          return;
        }

        // Acknowledged: the handler's promise waits on the reply thenable before resolving.
        if (parent.type === 'ReturnStatement' || parent.type === 'AwaitExpression') return;
        // Arrow implicit return: `async (req, reply) => reply.send(x)`.
        if (parent.type === 'ArrowFunctionExpression' && parent.body === node) return;

        // A bare statement — the shape that provably resolves to undefined.
        if (parent.type === 'ExpressionStatement') {
          context.report({ node, messageId: 'unreturned', data: { name: root.name } });
        }
      },
    };
  },
};
