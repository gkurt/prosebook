// Local Oxlint rules for conventions no built-in rule covers.

// `use*` names are reserved for hooks. A variable initialized with something that can't be a function isn't one.
const NON_FUNCTION_INITS = new Set([
  'Literal',
  'TemplateLiteral',
  'ObjectExpression',
  'ArrayExpression',
  'NewExpression',
  'ClassExpression',
  'BinaryExpression',
  'LogicalExpression',
  'UnaryExpression',
  'UpdateExpression',
  'AwaitExpression',
  'JSXElement',
  'JSXFragment',
]);

/** @param {any} node */
function unwrapTs(node) {
  while (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression')
    node = node.expression;
  return node;
}

const hookPrefix = {
  meta: { messages: { reserved: '`{{name}}` is not a function. The `use` prefix is reserved for React hooks.' } },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !/^use[A-Z0-9]/.test(node.id.name) || !node.init) return;
        if (!NON_FUNCTION_INITS.has(unwrapTs(node.init).type)) return;
        context.report({ node: node.id, messageId: 'reserved', data: { name: node.id.name } });
      },
    };
  },
};

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);

const explainedEffect = {
  meta: {
    messages: {
      unexplained:
        'Avoid effects unless truly necessary; most are better as derived state, event handlers, or a custom hook — read https://react.dev/learn/you-might-not-need-an-effect. ' +
        'If this one is needed, explain it: put a comment above it, or pass a named function (`{{hook}}(function syncScroll() {…})`).',
    },
  },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      CallExpression(node) {
        const { callee } = node;
        const hook = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? callee.property.name : undefined;
        if (!EFFECT_HOOKS.has(hook)) return;
        const [effect] = node.arguments;
        if (!effect || effect.type === 'Identifier' || (effect.type === 'FunctionExpression' && effect.id)) return;
        let statement = node;
        while (statement.parent && !Array.isArray(statement.parent.body)) statement = statement.parent;
        // A trailing comment on the previous line doesn't count; it describes that line.
        const previous = context.sourceCode.getTokenBefore(statement);
        const explained = context.sourceCode
          .getCommentsBefore(statement)
          .some((comment) => !previous || comment.loc.start.line > previous.loc.end.line);
        if (explained) return;
        context.report({ node: callee, messageId: 'unexplained', data: { hook } });
      },
    };
  },
};

// React 19 renders a context directly as its provider. Only `*Context` names are checked, so
// component namespaces such as Radix's `<Tooltip.Provider>` are left alone.
const contextProvider = {
  meta: {
    fixable: 'code',
    messages: { provider: 'Render `<{{context}}>` directly; `<{{context}}.Provider>` is legacy since React 19.' },
  },
  /** @param {any} context */
  create(context) {
    return {
      /** @param {any} node */
      JSXElement(node) {
        const { name } = node.openingElement;
        if (name.type !== 'JSXMemberExpression' || name.property.name !== 'Provider') return;
        if (name.object.type !== 'JSXIdentifier' || !name.object.name.endsWith('Context')) return;
        const contextName = name.object.name;
        context.report({
          node: name,
          messageId: 'provider',
          data: { context: contextName },
          /** @param {any} fixer */
          fix: (fixer) =>
            [node.openingElement, node.closingElement].filter(Boolean).map((element) => fixer.replaceText(element.name, contextName)),
        });
      },
    };
  },
};

export default {
  meta: { name: 'local' },
  rules: { 'hook-prefix': hookPrefix, 'explained-effect': explainedEffect, 'context-provider': contextProvider },
};
